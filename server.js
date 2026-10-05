const next = require("next")
require("dotenv").config()
const express = require("express")
const bodyParser = require("body-parser")
const cors = require("cors")
const admin = require("firebase-admin")
const { v2: cloudinary } = require("cloudinary")
const axios = require("axios")

// ================= NEXT.JS =================
const dev = process.env.NODE_ENV !== "production"
const nextApp = next({ dev })
const handle = nextApp.getRequestHandler()

// ================= CLOUDINARY =================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

// ================= FIREBASE =================
// Credentials come from environment variables so the private key is never
// committed. A local server/service-account-key.json (gitignored) is still
// accepted for development.
function loadServiceAccount() {
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env
  if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
    return {
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      // Hosting dashboards usually store newlines in the key as "\n".
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }
  }
  try {
    return require("./server/service-account-key.json")
  } catch {
    throw new Error(
      "Firebase credentials missing: set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL " +
      "and FIREBASE_PRIVATE_KEY (or provide server/service-account-key.json locally)."
    )
  }
}

let db
try {
  const serviceAccount = loadServiceAccount()
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    })
  }
  db = admin.firestore()
  db.settings({ ignoreUndefinedProperties: true })
  console.log("Firebase initialized")
} catch (err) {
  console.error("Firebase init failed:", err)
  process.exit(1)
}

// ================= PRICING MAP =================
const SERVICE_PRICES = {
  instant: 2000,
  weekly_1: 1250,
  weekly_2: 2500,
  weekly_3: 3750,
  upgrade_basic: 12000,
  upgrade_standard: 20000,
  upgrade_premium: 35000,
  wasteBags_small: 500,
  wasteBags_medium: 900,
  wasteBags_large: 1500,
  support: 0,
}

const WEEKLY_PLAN_LABELS = {
  weekly_1: "1 pickup/week",
  weekly_2: "2 pickups/week",
  weekly_3: "3 pickups/week",
}

// ================= FLAXXA WAPI =================
const WAPI_BASE_URL = (process.env.WAPI_BASE_URL || "https://wapi.flaxxa.com").replace(/\/$/, "")
const WAPI_TOKEN = process.env.WAPI_TOKEN

/**
 * Normalize phone — strip "whatsapp:" prefix if present.
 * Flaxxa accepts e.g. "+2348012345678" or "2348012345678"
 */
function normalizePhone(phone) {
  if (!phone) return phone
  return phone.replace(/^whatsapp:/i, "").trim()
}

/**
 * Send a free-form WhatsApp text message via Flaxxa WAPI.
 * POST /api/v1/sendmessage
 *
 * ⚠️  Only works within the 24-hour customer service window
 *     (i.e. the customer must have messaged you first).
 *     For outbound notifications use sendWhatsAppTemplate() below.
 */
async function sendWhatsAppMessage(to, message) {
  try {
    const phone = normalizePhone(to)
    if (!WAPI_TOKEN || !phone) return

    const response = await axios.post(
      `${WAPI_BASE_URL}/api/v1/sendmessage`,
      { token: WAPI_TOKEN, phone, message },
      { headers: { "Content-Type": "application/json" }, timeout: 15000 }
    )
    console.log(`WhatsApp sent to ${phone} — message_id: ${response.data?.message_id ?? "n/a"}`)
    return response.data
  } catch (err) {
    console.error("WhatsApp send failed:", err.response?.data || err.message)
  }
}

/**
 * Send an approved WhatsApp template message via Flaxxa WAPI.
 * POST /api/v1/sendtemplatemessage
 *
 * Used for outbound notifications (driver assigned, pickup complete)
 * where the 24-hour free-form window may have expired.
 *
 * SETUP REQUIRED — create two approved templates in your Flaxxa dashboard:
 *
 *   1. name: "driver_assigned"   language: en_US
 *      body: "Driver {{1}} has been assigned to your pickup on {{2}}."
 *
 *   2. name: "pickup_completed"  language: en_US
 *      body: "Your pickup scheduled for {{1}} has been completed. Thank you for choosing WasteCore."
 *
 * Rename the template_name strings in setupStatusListeners() if you use
 * different names in the Flaxxa dashboard.
 */
async function sendWhatsAppTemplate(to, templateName, language = "en_US", components = []) {
  try {
    const phone = normalizePhone(to)
    if (!WAPI_TOKEN || !phone) return

    const response = await axios.post(
      `${WAPI_BASE_URL}/api/v1/sendtemplatemessage`,
      {
        token: WAPI_TOKEN,
        phone,
        template_name: templateName,
        template_language: language,
        components,
      },
      { headers: { "Content-Type": "application/json" }, timeout: 15000 }
    )
    console.log(`Template "${templateName}" sent to ${phone}`)
    return response.data
  } catch (err) {
    console.error("Template send failed:", err.response?.data || err.message)
  }
}

// ================= FIRESTORE LISTENERS =================
function setupStatusListeners() {
  const handleChanges = (collectionName) => {
    db.collection(collectionName).onSnapshot(
      (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
         try {
          const data = change.doc.data()

          // Record the current status on existing/new docs without notifying,
          // so later non-status edits don't look like a status change.
          if (change.type === "added" && data.notifiedStatus === undefined) {
            await change.doc.ref.update({ notifiedStatus: data.status ?? null })
            return
          }

          if (change.type === "modified") {
            // Only notify on a status change. Other edits (e.g. reassigning a
            // collector) also fire "modified" and must not re-send messages
            // or create duplicate invoices.
            if (data.status === data.notifiedStatus) return
            await change.doc.ref.update({ notifiedStatus: data.status ?? null })

            if (data.status === "assigned") {
              await sendWhatsAppTemplate(
                data.customerPhone,
                "driver_assigned",
                "en_US",
                [
                  {
                    type: "body",
                    parameters: [
                      // Collector details are admin-only; never sent to customers.
                      { type: "text", text: "your driver" },
                      { type: "text", text: data.pickupDate },
                    ],
                  },
                ]
              )
            }

            if (data.status === "completed") {
              await sendWhatsAppTemplate(
                data.customerPhone,
                "pickup_completed",
                "en_US",
                [
                  {
                    type: "body",
                    parameters: [
                      { type: "text", text: data.pickupDate },
                    ],
                  },
                ]
              )
              await db.collection("invoices").add({
                customerPhone: data.customerPhone,
                amount: SERVICE_PRICES[data.serviceType] ?? 0,
                status: "paid",
                relatedPickupId: change.doc.id,
                createdAt: new Date().toISOString(),
              })
            }
          }
         } catch (err) {
          console.error(`Status listener failed on ${collectionName}/${change.doc.id}:`, err)
         }
        })
      },
      (err) => console.error(`Snapshot listener error on ${collectionName}:`, err)
    )
  }

  handleChanges("instantPickups")
  handleChanges("pickupRequests")
  handleChanges("upgradeRequests")
  handleChanges("wasteBagOrders")
  handleChanges("supportTickets")
}

// ================= HELPERS =================
function routeAfterService(serviceType) {
  switch (serviceType) {
    case "instant":    return "pickup_address"
    case "weekly":     return "weekly_plan_select"
    case "upgrade":    return "upgrade_choose"
    case "wasteBags":  return "bags_choose"
    case "support":    return "support_category"
    default:           return "pickup_address"
  }
}

function promptForStep(step) {
  switch (step) {
    case "pickup_address":      return "Your pickup address?"
    case "weekly_plan_select":  return "__show_weekly_menu__"
    case "upgrade_choose":      return "__show_upgrade_menu__"
    case "bags_choose":         return "__show_bags_menu__"
    case "support_category":    return "__show_support_menu__"
    default:                    return "Please continue."
  }
}

// ================= START SERVER =================
nextApp.prepare().then(() => {
  const app = express()

  const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) callback(null, true)
        else callback(new Error(`CORS: origin ${origin} not allowed`))
      },
      credentials: true,
    })
  )
  app.use(bodyParser.urlencoded({ extended: false }))
  app.use(bodyParser.json())

  // -----------------------------------------------------------------------
  // Meta WhatsApp Cloud API Webhook Parser
  //
  // Flaxxa forwards the raw Meta webhook payload. Shape:
  // {
  //   "object": "whatsapp_business_account",
  //   "entry": [{
  //     "changes": [{
  //       "value": {
  //         "messages": [{
  //           "from": "2348012345678",
  //           "type": "text",
  //           "text": { "body": "hi" },
  //           "image": { "id": "...", "mime_type": "image/jpeg" }
  //         }]
  //       }
  //     }]
  //   }]
  // }
  // -----------------------------------------------------------------------
  function extractIncoming(req) {
    try {
      const entry    = req.body?.entry?.[0]
      const change   = entry?.changes?.[0]
      const value    = change?.value
      const message  = value?.messages?.[0]

      if (!message) return { from: "", msg: "", hasImage: false, mediaId: null }

      const rawPhone = (message.from || "").toString().trim()
      const normalizedFrom = rawPhone
        ? `whatsapp:${rawPhone.startsWith("+") ? rawPhone : `+${rawPhone}`}`
        : ""

      const msgType = (message.type || "text").toString().toLowerCase()

      const text = (
        msgType === "text"
          ? message.text?.body || ""
          : msgType === "button"
          ? message.button?.text || ""
          : msgType === "interactive"
          ? message.interactive?.button_reply?.title ||
            message.interactive?.list_reply?.title || ""
          : ""
      ).toString().trim().toLowerCase().substring(0, 500)

      // Image — Meta sends media ID, not a URL.
      // We fetch the URL via the Graph API using the media ID.
      const hasImage = msgType === "image"
      const mediaId  = hasImage ? message.image?.id || null : null

      const messageId = message.id || null
      return { from: normalizedFrom, msg: text, hasImage, mediaId, messageId }
    } catch (e) {
      console.error("extractIncoming error:", e)
      return { from: "", msg: "", hasImage: false, mediaId: null, messageId: null }
    }
  }

  /**
   * Resolve a Meta media ID to a download URL, then download the bytes.
   * Requires WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN in .env
   */
  async function downloadMetaMedia(mediaId) {
    // 1. Get the download URL from Graph API
    const infoRes = await axios.get(
      `https://graph.facebook.com/v19.0/${mediaId}`,
      {
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
        timeout: 10000,
      }
    )
    const mediaUrl = infoRes.data.url

    // 2. Download the actual bytes
    const dlRes = await axios.get(mediaUrl, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
    })
    return Buffer.from(dlRes.data, "binary")
  }

  async function downloadMedia(mediaUrl) {
    const response = await axios.get(mediaUrl, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: { Authorization: `Bearer ${WAPI_TOKEN}` },
    })
    return Buffer.from(response.data, "binary")
  }

  async function uploadImageToCloudinary(imageBuffer, from) {
    return new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            folder: "waste-connect/receipts",
            resource_type: "image",
            public_id: `receipt_${from.replace(/whatsapp:\+?/i, "")}_${Date.now()}`,
          },
          (error, result) => (error ? reject(error) : resolve(result.secure_url))
        )
        .end(imageBuffer)
    })
  }

  async function uploadImageFallback(imageBuffer, from) {
    const base64Image = imageBuffer.toString("base64")
    const docId = `receipt_${from.replace(/whatsapp:\+?/i, "")}_${Date.now()}`
    await db.collection("imageFallbacks").doc(docId).set({
      imageData: base64Image,
      customerNumber: from,
      uploadedAt: new Date().toISOString(),
    })
    return `firebase:${docId}`
  }

  async function handleReceiptUpload(mediaId, from) {
    const buffer = await downloadMetaMedia(mediaId)
    try {
      return await uploadImageToCloudinary(buffer, from)
    } catch {
      return await uploadImageFallback(buffer, from)
    }
  }

  // ================= WHATSAPP WEBHOOK VERIFICATION =================
  // Meta calls GET /whatsapp once when you register the webhook URL
  app.get("/whatsapp", (req, res) => {
    const mode      = req.query["hub.mode"]
    const token     = req.query["hub.verify_token"]
    const challenge = req.query["hub.challenge"]
    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log("Webhook verified by Meta")
      return res.status(200).send(challenge)
    }
    res.sendStatus(403)
  })

  // ================= WHATSAPP WEBHOOK =================
  app.post("/whatsapp", async (req, res) => {
    // Acknowledge immediately — Flaxxa expects a fast 200 OK
    res.sendStatus(200)

    const { from, msg, hasImage, mediaId, messageId } = extractIncoming(req)
    if (!from) {
      console.warn("Webhook received with no sender phone — ignored.", req.body)
      return
    }

    // DEDUPLICATION — Flaxxa sometimes sends the same webhook twice.
    // We store the last processed message ID per user and ignore duplicates.
    if (messageId) {
      const dedupRef = db.collection("processedMessages").doc(messageId)
      const dedupDoc = await dedupRef.get()
      if (dedupDoc.exists) {
        console.log(`Duplicate webhook ignored — messageId: ${messageId}`)
        return
      }
      // Mark as processed (auto-expire after 10 minutes via TTL or just leave it)
      await dedupRef.set({ processedAt: new Date().toISOString(), from })
    }

    // GLOBAL CANCEL
    if (msg === "cancel") {
      await db.collection("sessions").doc(from).delete()
      await sendWhatsAppMessage(from, "Operation cancelled. Type hi to start again.")
      return
    }

    const sessionsRef = db.collection("sessions").doc(from)
    const sessionDoc = await sessionsRef.get()
    let session = sessionDoc.exists ? sessionDoc.data() : { step: "0", data: {} }

    const send = (text) => sendWhatsAppMessage(from, text)

    try {
      // ── Active request check (only at conversation start) ────────────────
      if (session.step === "0" || session.step === "0.5") {
        const [activeInstant, activeMonthly] = await Promise.all([
          db.collection("instantPickups")
            .where("customerPhone", "==", from)
            .where("status", "in", ["pending", "assigned"])
            .get(),
          db.collection("pickupRequests")
            .where("customerPhone", "==", from)
            .where("status", "in", ["pending", "assigned"])
            .get(),
        ])

        if (!activeInstant.empty || !activeMonthly.empty) {
          const activeDoc = !activeInstant.empty ? activeInstant.docs[0] : activeMonthly.docs[0]
          const data = activeDoc.data()
          await send(
            `Active Request Found\n\nService: ${WEEKLY_PLAN_LABELS[data.serviceType] || data.serviceType}\nPickup Date: ${data.pickupDate}\nStatus: ${data.status}\n\n` +
            `You can still:\n1 - Book another service\n2 - Order Waste Bags\n3 - Speak to Support\n\nReply with a number or type cancel to restart.`
          )
          session.step = "active_menu"
          await sessionsRef.set(session)
          return
        }
      }

      // ================= SESSION SWITCH =================
      switch (session.step) {

        // ── ENTRY ──────────────────────────────────────────────────────────
        case "0":
          if (msg === "hi" || msg === "hello") {
            await send(`Welcome to WasteCore\n\n1 - Book Pickup\n\nReply with 1 to start. Type cancel anytime to restart.`)
            session.step = "0.5"
          } else {
            await send("To start, type hi.")
          }
          break

        case "0.5":
          if (msg === "1") {
            await send("What is your full name?")
            session.step = "1"
          } else {
            await send("Reply with 1 to start.")
          }
          break

        // ── ACTIVE-REQUEST SIDE MENU ───────────────────────────────────────
        case "active_menu":
          if (msg === "1") {
            await send("What is your full name?")
            session.step = "1"
          } else if (msg === "2") {
            session.data.serviceType = "wasteBags"
            await send("What is your full name?")
            session.step = "1"
          } else if (msg === "3") {
            session.data.serviceType = "support"
            await send("What is your full name?")
            session.step = "1"
          } else {
            await send("Please reply with 1, 2, or 3.")
          }
          break

        // ── NAME & SERVICE SELECTION ───────────────────────────────────────
        case "1":
          session.data.name = msg.substring(0, 100)
          if (!session.data.serviceType) {
            await send(
              `Choose service:\n1 - Instant Pickup (NGN 2,000)\n2 - Weekly Pickup\n3 - Upgrade Plan\n4 - Order Waste Bags\n5 - Speak to Support`
            )
            session.step = "1.5"
          } else {
            const nextStep = routeAfterService(session.data.serviceType)
            session.step = nextStep
            const prompt = promptForStep(nextStep)
            if (prompt === "__show_weekly_menu__") {
              await send(`Choose your weekly pickup plan:\n\n1 - 1 pickup/week (NGN 1,250/week)\n2 - 2 pickups/week (NGN 2,500/week)\n3 - 3 pickups/week (NGN 3,750/week)\n\nReply 1, 2, or 3.`)
              session.step = "weekly_plan_choose"
            } else if (prompt === "__show_upgrade_menu__") {
              await send(`Available Upgrade Plans\n\n1 - Basic  NGN 12,000/mo\n   Weekly pickup, up to 5 bags\n\n2 - Standard  NGN 20,000/mo\n   3x/week pickup, up to 15 bags, priority support\n\n3 - Premium  NGN 35,000/mo\n   Daily pickup, unlimited bags, dedicated driver, free bags monthly\n\nReply 1, 2, or 3.`)
              session.step = "upgrade_select"
            } else if (prompt === "__show_bags_menu__") {
              await send(`Waste Bag Sizes\n\n1 - Small  NGN 500 (pack of 10)\n2 - Medium  NGN 900 (pack of 10)\n3 - Large  NGN 1,500 (pack of 10)\n\nReply 1, 2, or 3.`)
              session.step = "bags_select"
            } else if (prompt === "__show_support_menu__") {
              await send(`Support Categories\n\n1 - Missed Pickup\n2 - Billing Issue\n3 - Driver Complaint\n4 - Change Pickup Date\n5 - Other\n\nReply with a number.`)
              session.step = "support_select"
            } else {
              await send(prompt)
            }
          }
          break

        case "1.5":
          if      (msg === "1") session.data.serviceType = "instant"
          else if (msg === "2") session.data.serviceType = "weekly"
          else if (msg === "3") session.data.serviceType = "upgrade"
          else if (msg === "4") session.data.serviceType = "wasteBags"
          else if (msg === "5") session.data.serviceType = "support"
          else { await send("Reply 1-5."); break }
          {
            const nextStep = routeAfterService(session.data.serviceType)
            session.step = nextStep
            const prompt = promptForStep(nextStep)
            if (prompt === "__show_weekly_menu__") {
              await send(`Choose your weekly pickup plan:\n\n1 - 1 pickup/week (NGN 1,250/week)\n2 - 2 pickups/week (NGN 2,500/week)\n3 - 3 pickups/week (NGN 3,750/week)\n\nReply 1, 2, or 3.`)
              session.step = "weekly_plan_choose"
            } else if (prompt === "__show_upgrade_menu__") {
              await send(`Available Upgrade Plans\n\n1 - Basic  NGN 12,000/mo\n   Weekly pickup, up to 5 bags\n\n2 - Standard  NGN 20,000/mo\n   3x/week, up to 15 bags, priority support\n\n3 - Premium  NGN 35,000/mo\n   Daily pickup, unlimited bags, dedicated driver, free bags monthly\n\nReply 1, 2, or 3.`)
              session.step = "upgrade_select"
            } else if (prompt === "__show_bags_menu__") {
              await send(`Waste Bag Sizes\n\n1 - Small  NGN 500 (pack of 10)\n2 - Medium  NGN 900 (pack of 10)\n3 - Large  NGN 1,500 (pack of 10)\n\nReply 1, 2, or 3.`)
              session.step = "bags_select"
            } else if (prompt === "__show_support_menu__") {
              await send(`Support Categories\n\n1 - Missed Pickup\n2 - Billing Issue\n3 - Driver Complaint\n4 - Change Pickup Date\n5 - Other\n\nReply with a number.`)
              session.step = "support_select"
            } else {
              await send(prompt)
            }
          }
          break

        // ── WEEKLY PICKUP PLAN SELECTION ───────────────────────────────────
        case "weekly_plan_select":
          await send(`Choose your weekly pickup plan:\n\n1 - 1 pickup/week (NGN 1,250/week)\n2 - 2 pickups/week (NGN 2,500/week)\n3 - 3 pickups/week (NGN 3,750/week)\n\nReply 1, 2, or 3.`)
          session.step = "weekly_plan_choose"
          break

        case "weekly_plan_choose":
          if      (msg === "1") session.data.weeklyPlan = "weekly_1"
          else if (msg === "2") session.data.weeklyPlan = "weekly_2"
          else if (msg === "3") session.data.weeklyPlan = "weekly_3"
          else { await send("Please reply 1, 2, or 3."); break }
          session.data.serviceType = session.data.weeklyPlan
          await send("Your pickup address?")
          session.step = "pickup_address"
          break

        // ── INSTANT & WEEKLY PICKUP FLOW ───────────────────────────────────
        case "pickup_address":
          session.data.address = msg.substring(0, 300)
          await send("Waste type?\n\n1 - Organic\n2 - Plastic\n3 - Paper\n4 - Fabric\n\nOr type the name of your waste.")
          session.step = "pickup_waste"
          break

        case "pickup_waste":
          session.data.wasteType = msg.substring(0, 100)
          await send("Pickup start date (YYYY-MM-DD)?")
          session.step = "pickup_date"
          break

        case "pickup_date":
          if (!/^\d{4}-\d{2}-\d{2}$/.test(msg) || isNaN(Date.parse(msg))) {
            await send("Invalid date. Please use YYYY-MM-DD e.g. 2026-03-30.")
            break
          }
          session.data.pickupDate = msg
          await send(
            `Thank you ${session.data.name}!\n\nPlease make payment to:\nBank: Moniepoint\nAccount Name: WasteCore Limited\nAccount Number: 6614999315\n\nAmount: NGN ${SERVICE_PRICES[session.data.serviceType].toLocaleString()}\n\nAfter payment, upload your payment receipt image.`
          )
          session.step = "pickup_payment"
          break

        case "pickup_payment":
          if (!hasImage) { await send("Please upload an image of your payment receipt."); break }
          {
            const receiptUrl = await handleReceiptUpload(mediaId, from)
            const col = session.data.serviceType === "instant" ? "instantPickups" : "pickupRequests"
            const serviceLabel = WEEKLY_PLAN_LABELS[session.data.serviceType] || session.data.serviceType
            await db.collection(col).add({
              customerName: session.data.name,
              customerPhone: from,
              address: session.data.address,
              wasteType: session.data.wasteType,
              pickupDate: session.data.pickupDate,
              paymentReceiptUrl: receiptUrl,
              serviceType: session.data.serviceType,
              serviceLabel,
              status: "pending",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            await send("Confirming Transaction, you will get a notification shortly to confirm your transaction and booking.")
            await send(
              `Booked! Summary:\n\nService: ${serviceLabel}\nAddress: ${session.data.address}\nWaste: ${session.data.wasteType}\nDate: ${session.data.pickupDate}\nPayment received\n\nWe will notify you once a collector is assigned.`
            )
          }
          session.step = "done"
          break

        // ── UPGRADE PLAN FLOW ──────────────────────────────────────────────
        case "upgrade_choose":
          await send(`Available Upgrade Plans\n\n1 - Basic  NGN 12,000/mo\n   Weekly pickup, up to 5 bags\n\n2 - Standard  NGN 20,000/mo\n   3x/week, up to 15 bags, priority support\n\n3 - Premium  NGN 35,000/mo\n   Daily pickup, unlimited bags, dedicated driver, free bags monthly\n\nReply 1, 2, or 3.`)
          session.step = "upgrade_select"
          break

        case "upgrade_select":
          if      (msg === "1") session.data.upgradePlan = "basic"
          else if (msg === "2") session.data.upgradePlan = "standard"
          else if (msg === "3") session.data.upgradePlan = "premium"
          else { await send("Please reply 1, 2, or 3."); break }
          session.data.serviceType = `upgrade_${session.data.upgradePlan}`
          await send("Your pickup address for this plan?")
          session.step = "upgrade_address"
          break

        case "upgrade_address":
          session.data.address = msg.substring(0, 300)
          await send("Preferred start date (YYYY-MM-DD)?")
          session.step = "upgrade_date"
          break

        case "upgrade_date":
          if (!/^\d{4}-\d{2}-\d{2}$/.test(msg) || isNaN(Date.parse(msg))) {
            await send("Invalid date. Please use YYYY-MM-DD e.g. 2025-08-20.")
            break
          }
          session.data.startDate = msg
          {
            const amount = SERVICE_PRICES[session.data.serviceType]
            await send(
              `${session.data.upgradePlan.toUpperCase()} Plan\n\nAmount: NGN ${amount.toLocaleString()}/month\n\nPay to:\nBank: Moniepoint\nAccount Name: WasteCore Limited\nAccount Number: 6614999315\n\nUpload your payment receipt to confirm.`
            )
          }
          session.step = "upgrade_payment"
          break

        case "upgrade_payment":
          if (!hasImage) { await send("Please upload an image of your payment receipt."); break }
          {
            const receiptUrl = await handleReceiptUpload(mediaId, from)
            await db.collection("upgradeRequests").add({
              customerName: session.data.name,
              customerPhone: from,
              address: session.data.address,
              plan: session.data.upgradePlan,
              serviceType: session.data.serviceType,
              startDate: session.data.startDate,
              paymentReceiptUrl: receiptUrl,
              status: "pending",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            await send(
              `Upgrade request received!\n\nPlan: ${session.data.upgradePlan.toUpperCase()}\nAddress: ${session.data.address}\nStart Date: ${session.data.startDate}\nPayment received\n\nOur team will activate your plan within 24 hours.`
            )
          }
          session.step = "done"
          break

        // ── WASTE BAGS FLOW ────────────────────────────────────────────────
        case "bags_choose":
          await send(`Waste Bag Sizes\n\n1 - Small  NGN 500 (pack of 10)\n2 - Medium  NGN 900 (pack of 10)\n3 - Large  NGN 1,500 (pack of 10)\n\nReply 1, 2, or 3.`)
          session.step = "bags_select"
          break

        case "bags_select":
          if      (msg === "1") session.data.bagSize = "small"
          else if (msg === "2") session.data.bagSize = "medium"
          else if (msg === "3") session.data.bagSize = "large"
          else { await send("Please reply 1, 2, or 3."); break }
          await send("How many packs would you like to order?")
          session.step = "bags_quantity"
          break

        case "bags_quantity":
          {
            const qty = parseInt(msg, 10)
            if (isNaN(qty) || qty < 1 || qty > 100) {
              await send("Please enter a valid quantity between 1 and 100.")
              break
            }
            session.data.bagQuantity = qty
            session.data.bagTotal = SERVICE_PRICES[`wasteBags_${session.data.bagSize}`] * qty
            await send("Delivery address?")
            session.step = "bags_address"
          }
          break

        case "bags_address":
          session.data.address = msg.substring(0, 300)
          await send(
            `Order Summary\n\nSize: ${session.data.bagSize.toUpperCase()}\nPacks: ${session.data.bagQuantity}\nAddress: ${session.data.address}\nTotal: NGN ${session.data.bagTotal.toLocaleString()}\n\nPay to:\nBank: Moniepoint\nAccount Name: WasteCore Limited\nAccount Number: 6614999315\n\nUpload payment receipt to confirm.`
          )
          session.step = "bags_payment"
          break

        case "bags_payment":
          if (!hasImage) { await send("Please upload your payment receipt image."); break }
          {
            const receiptUrl = await handleReceiptUpload(mediaId, from)
            await db.collection("wasteBagOrders").add({
              customerName: session.data.name,
              customerPhone: from,
              bagSize: session.data.bagSize,
              quantity: session.data.bagQuantity,
              totalAmount: session.data.bagTotal,
              deliveryAddress: session.data.address,
              serviceType: "wasteBags",
              paymentReceiptUrl: receiptUrl,
              status: "pending",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            await send(
              `Order confirmed!\n\n${session.data.bagSize.toUpperCase()} bags x ${session.data.bagQuantity} pack(s)\nDelivery: ${session.data.address}\nTotal: NGN ${session.data.bagTotal.toLocaleString()}\nPayment received\n\nExpect delivery within 1-2 business days.`
            )
          }
          session.step = "done"
          break

        // ── SUPPORT FLOW ───────────────────────────────────────────────────
        case "support_category":
          await send(`Support Categories\n\n1 - Missed Pickup\n2 - Billing Issue\n3 - Driver Complaint\n4 - Change Pickup Date\n5 - Other\n\nReply with a number.`)
          session.step = "support_select"
          break

        case "support_select":
          {
            const categories = {
              "1": "Missed Pickup",
              "2": "Billing Issue",
              "3": "Driver Complaint",
              "4": "Change Pickup Date",
              "5": "Other",
            }
            if (!categories[msg]) { await send("Please reply 1 to 5."); break }
            session.data.supportCategory = categories[msg]
            await send("Please describe your issue in detail.")
            session.step = "support_describe"
          }
          break

        case "support_describe":
          session.data.supportMessage = msg.substring(0, 1000)
          await send("What is your preferred contact time? e.g. mornings, afternoons, or type anytime.")
          session.step = "support_contact_time"
          break

        case "support_contact_time":
          session.data.contactTime = msg.substring(0, 100)
          {
            const ticketId = `TKT-${Date.now().toString().slice(-6)}`
            await db.collection("supportTickets").add({
              ticketId,
              customerName: session.data.name,
              customerPhone: from,
              category: session.data.supportCategory,
              message: session.data.supportMessage,
              contactTime: session.data.contactTime,
              status: "open",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            await send(
              `Support ticket raised!\n\nTicket ID: ${ticketId}\nCategory: ${session.data.supportCategory}\nContact Time: ${session.data.contactTime}\n\nA WasteCore agent will reach out to you shortly. Save your ticket ID for follow-up.`
            )
          }
          session.step = "done"
          break

        // ── DEFAULT ────────────────────────────────────────────────────────
        default:
          await send("To start, type hi.")
          session = { step: "0", data: {} }
      }

      if (session.step === "done") {
        try { await sessionsRef.delete() } catch (e) {
          console.error("Failed to delete session:", e)
        }
      } else {
        await sessionsRef.set(session)
      }

    } catch (error) {
      console.error("Unexpected error:", error)
      try { await sendWhatsAppMessage(from, "An unexpected error occurred. Please try again.") } catch (_) {}
    }
  })

  // ================= ADMIN ACCOUNTS =================
  // Dashboard logins use Firebase Auth. Usernames map to a synthetic email
  // (never emailed). Roles live in admins/{uid}: one "main" admin, created
  // once via /setup, who manages any number of "sub" admins.
  const ADMIN_EMAIL_DOMAIN = "admins.wastecore.local"
  const USERNAME_RE = /^[a-z0-9._-]{3,30}$/
  const mainAdminRef = () => db.collection("config").doc("mainAdmin")

  function parseCredentials(body) {
    const username = String(body?.username ?? "").trim().toLowerCase()
    const password = String(body?.password ?? "")
    if (!USERNAME_RE.test(username)) {
      return { error: "Username must be 3-30 characters: letters, numbers, dot, dash or underscore." }
    }
    if (password.length < 8) return { error: "Password must be at least 8 characters." }
    return { username, password }
  }

  function authErrorMessage(err) {
    if (err?.code === "auth/email-already-exists") return "That username is already taken."
    if (err?.code === "auth/invalid-password") return "Password must be at least 8 characters."
    return "Something went wrong. Please try again."
  }

  // Verifies the caller's Firebase ID token and that they are the active main admin.
  async function requireMainAdmin(req, res, next) {
    try {
      const token = (req.headers.authorization || "").replace(/^Bearer /, "")
      const decoded = await admin.auth().verifyIdToken(token, true)
      const profile = await db.collection("admins").doc(decoded.uid).get()
      if (!profile.exists || profile.data().role !== "main" || profile.data().active === false) {
        return res.status(403).json({ error: "Only the main admin can manage sub-admins." })
      }
      req.adminUid = decoded.uid
      next()
    } catch {
      res.status(401).json({ error: "Please sign in again." })
    }
  }

  async function loadSubAdmin(uid) {
    const doc = await db.collection("admins").doc(uid).get()
    return doc.exists && doc.data().role === "sub" ? doc : null
  }

  app.get("/api/admin-auth/status", async (req, res) => {
    try {
      const main = await mainAdminRef().get()
      res.json({ setupRequired: !main.exists })
    } catch (err) {
      console.error("admin status failed:", err)
      res.status(500).json({ error: "Could not check admin setup." })
    }
  })

  // One-time creation of the main admin. config/mainAdmin is claimed with
  // create(), which fails if it exists, so only the first request wins.
  app.post("/api/admin-auth/setup", async (req, res) => {
    const creds = parseCredentials(req.body)
    if (creds.error) return res.status(400).json({ error: creds.error })

    try {
      await mainAdminRef().create({ claimedAt: new Date().toISOString() })
    } catch {
      return res.status(409).json({ error: "The main admin has already been set up. Please sign in." })
    }

    try {
      const user = await admin.auth().createUser({
        email: `${creds.username}@${ADMIN_EMAIL_DOMAIN}`,
        password: creds.password,
        displayName: creds.username,
      })
      const now = new Date().toISOString()
      await db.collection("admins").doc(user.uid).set({
        username: creds.username, role: "main", active: true, createdAt: now,
      })
      await mainAdminRef().set({ uid: user.uid, claimedAt: now })
      res.status(201).json({ ok: true })
    } catch (err) {
      await mainAdminRef().delete().catch(() => {})
      console.error("main admin setup failed:", err)
      res.status(400).json({ error: authErrorMessage(err) })
    }
  })

  app.post("/api/sub-admins", requireMainAdmin, async (req, res) => {
    const creds = parseCredentials(req.body)
    if (creds.error) return res.status(400).json({ error: creds.error })
    try {
      const user = await admin.auth().createUser({
        email: `${creds.username}@${ADMIN_EMAIL_DOMAIN}`,
        password: creds.password,
        displayName: creds.username,
      })
      await db.collection("admins").doc(user.uid).set({
        username: creds.username,
        role: "sub",
        active: true,
        createdAt: new Date().toISOString(),
        createdBy: req.adminUid,
      })
      res.status(201).json({ uid: user.uid })
    } catch (err) {
      console.error("sub-admin create failed:", err)
      res.status(err?.code === "auth/email-already-exists" ? 409 : 400).json({ error: authErrorMessage(err) })
    }
  })

  // Reset password and/or activate/deactivate a sub-admin.
  app.patch("/api/sub-admins/:uid", requireMainAdmin, async (req, res) => {
    try {
      const doc = await loadSubAdmin(req.params.uid)
      if (!doc) return res.status(404).json({ error: "Sub-admin not found." })

      const authUpdate = {}
      if (req.body?.password !== undefined) {
        const password = String(req.body.password)
        if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." })
        authUpdate.password = password
      }
      if (typeof req.body?.active === "boolean") authUpdate.disabled = !req.body.active

      if (!Object.keys(authUpdate).length) return res.status(400).json({ error: "Nothing to update." })
      await admin.auth().updateUser(req.params.uid, authUpdate)
      // Sign them out everywhere after a password change or deactivation.
      await admin.auth().revokeRefreshTokens(req.params.uid)
      await doc.ref.update({
        ...(typeof req.body?.active === "boolean" ? { active: req.body.active } : {}),
        updatedAt: new Date().toISOString(),
      })
      res.json({ ok: true })
    } catch (err) {
      console.error("sub-admin update failed:", err)
      res.status(400).json({ error: authErrorMessage(err) })
    }
  })

  app.delete("/api/sub-admins/:uid", requireMainAdmin, async (req, res) => {
    try {
      const doc = await loadSubAdmin(req.params.uid)
      if (!doc) return res.status(404).json({ error: "Sub-admin not found." })
      await admin.auth().deleteUser(req.params.uid).catch((err) => {
        if (err?.code !== "auth/user-not-found") throw err
      })
      await doc.ref.delete()
      res.json({ ok: true })
    } catch (err) {
      console.error("sub-admin delete failed:", err)
      res.status(400).json({ error: "Could not delete the sub-admin. Please try again." })
    }
  })

  app.get("/health", (req, res) => {
    res.json({ status: "OK", timestamp: new Date().toISOString() })
  })
  app.use((req, res) => handle(req, res))

  const port = process.env.PORT || 3000
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`)
    setupStatusListeners()
  })
})