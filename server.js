const next = require("next")

require("dotenv").config()
const express = require("express")
const bodyParser = require("body-parser")
const cors = require("cors")
const twilio = require("twilio")
const admin = require("firebase-admin")
const { v2: cloudinary } = require("cloudinary")
const axios = require("axios")

// ====== NEXT.JS SETUP ======
const dev = process.env.NODE_ENV !== "production"
const nextApp = next({ dev })
const handle = nextApp.getRequestHandler()

// ====== CLOUDINARY CONFIG ======
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

// ====== FIREBASE ADMIN ======
let db
try {
  const serviceAccount = require('./server/service-account-key.json');

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  db = admin.firestore();
  console.log("✅ Firebase Admin initialized successfully via JSON file");

} catch (error) {
  console.error("❌ Firebase Admin initialization failed:", error);
  console.error("Make sure 'service-account-key.json' exists in the server folder");
  process.exit(1);
}

// ====== START SERVER AFTER NEXT IS READY ======
nextApp.prepare().then(() => {

  const app = express()

  app.use(
    cors({
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      credentials: true,
    }),
  )

  app.use(bodyParser.urlencoded({ extended: false }))
  app.use(bodyParser.json())

  // ====== HELPER FUNCTIONS ======

  function hasImageAttachment(req) {
    return (
      req.body.NumMedia > 0 &&
      req.body.MediaContentType0 &&
      req.body.MediaContentType0.startsWith("image/")
    )
  }

  async function downloadTwilioMedia(mediaUrl) {
    try {
      const response = await axios.get(mediaUrl, {
        responseType: "arraybuffer",
        timeout: 15000,
        auth: {
          username: process.env.TWILIO_ACCOUNT_SID,
          password: process.env.TWILIO_AUTH_TOKEN,
        },
      })
      return Buffer.from(response.data, "binary")
    } catch (error) {
      console.error("❌ Twilio media download error:", error.message)
      throw new Error("Failed to download media from Twilio")
    }
  }

  async function uploadImageToCloudinary(imageBuffer, from) {
    return new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          folder: "waste-connect/receipts",
          resource_type: "image",
          public_id: `receipt_${from.replace("whatsapp:", "")}_${Date.now()}`,
        },
        (error, result) => {
          if (error) {
            console.error("❌ Cloudinary upload failed:", error)
            reject(error)
          } else {
            console.log("✅ Cloudinary upload success:", result.secure_url)
            resolve(result.secure_url)
          }
        },
      ).end(imageBuffer)
    })
  }

  async function uploadImageFallback(imageBuffer, from) {
    try {
      const base64Image = imageBuffer.toString("base64")
      const docId = `receipt_${from.replace("whatsapp:", "")}_${Date.now()}`
      await db.collection("imageFallbacks").doc(docId).set({
        imageData: base64Image,
        customerNumber: from,
        uploadedAt: new Date().toISOString(),
      })
      console.log("✅ Fallback storage success")
      return `firebase:${docId}`
    } catch (error) {
      console.error("❌ Fallback storage failed:", error)
      throw new Error("All storage methods failed")
    }
  }

  // ====== WHATSAPP WEBHOOK ======
  app.post("/whatsapp", async (req, res) => {
    console.log("\n=== NEW WHATSAPP MESSAGE ===")
    console.log("From:", req.body.From)
    console.log("Body:", req.body.Body)
    console.log("Media count:", req.body.NumMedia)

    const msg = req.body.Body?.trim().toLowerCase()
    const from = req.body.From
    const mediaUrl = req.body.MediaUrl0

    const sessionsRef = db.collection("sessions").doc(from)
    const sessionDoc = await sessionsRef.get()
    let session = sessionDoc.exists ? sessionDoc.data() : { step: 0, data: {} }

    const twiml = new twilio.twiml.MessagingResponse()
    const send = (text) => twiml.message(text)

    try {
      switch (session.step) {

        case 0:
          if (msg === "hi" || msg === "hello") {
            send("👋 Welcome to Waste Core! What is your full name?")
            session.step = 1
          } else {
            send("💬 To start a new request, type *hi*.")
          }
          break

        case 1:
          session.data.name = msg
          send("📍 Your pickup address?")
          session.step = 2
          break

        case 2:
          session.data.address = msg
          send("🗑️ Waste type? Reply with:\n1. Household\n2. Organic\n3. Construction\n4. Recyclable\n5. Electronic")
          session.step = 3
          break

        case 3:
          const types = ["Household", "Organic", "Construction", "Recyclable", "Electronic"]
          const typeIndex = Number.parseInt(msg) - 1
          if (isNaN(typeIndex) || typeIndex < 0 || typeIndex >= types.length) {
            send("❗Please select a valid waste type (1-5)")
          } else {
            session.data.wasteType = types[typeIndex]
            send("📅 Pickup date? (YYYY-MM-DD)")
            session.step = 4
          }
          break

        case 4:
          if (!/^\d{4}-\d{2}-\d{2}$/.test(msg)) {
            send("❗Please enter date in YYYY-MM-DD format")
          } else {
            session.data.pickupDate = msg
            session.data.payment = {
              account: "1234567890",
              bank: "WasteConnect Bank",
              amount: 2000,
            }
            send(`💳 Please upload an image of your transaction receipt for ₦${session.data.payment.amount} payment to ${session.data.payment.account} (${session.data.payment.bank}).\n\nYou can upload a screenshot of receipt as proof of payment.`)
            session.step = 5
          }
          break

        case 5:
          if (hasImageAttachment(req)) {
            try {
              const imageBuffer = await downloadTwilioMedia(mediaUrl)

              let receiptUrl
              try {
                receiptUrl = await uploadImageToCloudinary(imageBuffer, from)
              } catch (cloudError) {
                console.log("⚠️ Cloudinary failed, using fallback")
                receiptUrl = await uploadImageFallback(imageBuffer, from)
              }

              const request = {
                customerName: session.data.name,
                customerPhone: from,
                address: session.data.address,
                wasteType: session.data.wasteType,
                pickupDate: session.data.pickupDate,
                paymentReceiptUrl: receiptUrl,
                status: "pending",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }

              await db.collection("pickupRequests").add(request)

              send(`✅ Payment proof received!\nPickup scheduled for ${session.data.pickupDate}.`)

              session.step = null
              await sessionsRef.delete()

            } catch (error) {
              console.error("❌ Receipt processing failed:", error)
              send("⚠️ Failed to process receipt. Please try again.")
            }
          } else {
            send("❗Please upload an image as proof of payment.")
          }
          break

        default:
          send("💬 To start a new request, type *hi*.")
          session = { step: 0, data: {} }
          break
      }

      if (session.step !== null) {
        await sessionsRef.set(session)
      }

      res.set("Content-Type", "text/xml")
      res.send(twiml.toString())

    } catch (error) {
      console.error("❌ Unexpected error:", error)
      res.set("Content-Type", "text/xml")
      const errorTwiml = new twilio.twiml.MessagingResponse()
      errorTwiml.message("⚠️ An unexpected error occurred. Please try again.")
      res.send(errorTwiml.toString())
    }
  })

  // ====== HEALTH CHECK ======
  app.get("/health", (req, res) => {
    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      services: {
        firebase: !!db,
        cloudinary: !!cloudinary,
        twilio: !!process.env.TWILIO_ACCOUNT_SID,
      },
    })
  })

  // ====== NEXT.JS HANDLER ======
  // app.all("/", (req, res) => {
  //   return handle(req, res)
  // })
  app.use((req, res) => handle(req, res))

  const port = process.env.PORT || 3000

  app.listen(port, () => {
    console.log(`🚀 Combined Server running on http://localhost:${port}`)
    console.log(`📍 Health check: http://localhost:${port}/health`)
    console.log(`🤖 WhatsApp webhook: http://localhost:${port}/whatsapp`)
  })

})
