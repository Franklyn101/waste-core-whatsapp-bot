const next = require("next")
require("dotenv").config()
const express = require("express")
const bodyParser = require("body-parser")
const cors = require("cors")
const admin = require("firebase-admin")
const { v2: cloudinary } = require("cloudinary")
const axios = require("axios")
const crypto = require("crypto")

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
// committed. Either paste the whole key file into FIREBASE_SERVICE_ACCOUNT,
// or set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.
// A local server/service-account-key.json (gitignored) works for development.
const FIREBASE_ENV_VARS = [
  "FIREBASE_SERVICE_ACCOUNT",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
]

// Hosting dashboards often store the key's newlines as a literal "\n" and
// may keep surrounding quotes.
function cleanPrivateKey(key) {
  const pem = key.trim().replace(/^"|"$/g, "").replace(/\\n/g, "\n").trim()
  return `${pem}\n`
}

function loadServiceAccount() {
  const env = process.env

  if (env.FIREBASE_SERVICE_ACCOUNT?.trim()) {
    let parsed
    try {
      parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT is set but is not valid JSON. Paste the whole key file, including { and }.")
    }
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT is missing client_email or private_key. Paste the whole key file.")
    }
    return { ...parsed, private_key: cleanPrivateKey(parsed.private_key) }
  }

  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    return {
      projectId: env.FIREBASE_PROJECT_ID.trim(),
      clientEmail: env.FIREBASE_CLIENT_EMAIL.trim(),
      privateKey: cleanPrivateKey(env.FIREBASE_PRIVATE_KEY),
    }
  }

  try {
    return require("./server/service-account-key.json")
  } catch {
    // Report which variable names are visible (never their values) so a
    // misnamed or unapplied variable is easy to spot in the logs.
    const seen = FIREBASE_ENV_VARS.map((name) => `${name}=${env[name] ? "set" : "missing"}`).join(", ")
    throw new Error(
      `Firebase credentials missing (${seen}). Set FIREBASE_SERVICE_ACCOUNT to the whole key file, ` +
      "or set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY."
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
  // Monthly subscriptions
  upgrade_business_1: 5000,
  upgrade_business_2: 10000,
  upgrade_business_3: 15000,
  upgrade_household_1: 3000,
  upgrade_household_2: 6000,
  upgrade_household_3: 9000,
  // Retired plans, kept so older sessions and records still price correctly.
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

// One-off pickups are charged per bag of waste.
const PICKUP_PRICE_PER_BAG = {
  instant: 1000,
  scheduled: 650,
}
const MAX_BAGS_PER_PICKUP = 50

const SERVICE_MENU =
  `Choose service:\n` +
  `1 - Instant Pickup\n` +
  `2 - Schedule a Pickup\n` +
  `3 - Monthly Subscription\n` +
  `4 - Order Waste Bags\n` +
  `5 - Speak to Support\n` +
  `6 - About WasteCore & our services`

// Monthly subscription plans, by category. Plan ids are "<category>_<pickups per week>".
const MONTHLY_PLANS = {
  business: {
    title: "Business",
    blurb: "For shops, offices, salons, pharmacies and other businesses.",
    footer: "Business plans include priority scheduling and are eligible for Waste Recovery Credit.",
    prices: { 1: 5000, 2: 10000, 3: 15000 },
  },
  household: {
    title: "Household",
    blurb: "For homes and families.",
    footer: "",
    prices: { 1: 3000, 2: 6000, 3: 9000 },
  },
}

const SUBSCRIPTION_CATEGORY_MENU =
  `Monthly Subscription\n\n` +
  `1 - Business\n   ${MONTHLY_PLANS.business.blurb}\n\n` +
  `2 - Household\n   ${MONTHLY_PLANS.household.blurb}\n\n` +
  `Reply 1 or 2.`

function monthlyPlansMenu(category) {
  const c = MONTHLY_PLANS[category]
  const lines = [1, 2, 3].map((n) =>
    `${n} - NGN ${c.prices[n].toLocaleString()}/month  (${n} pickup${n > 1 ? "s" : ""} per week)`
  )
  return `${c.title} Plans\n\n${lines.join("\n")}\n\n${c.footer ? c.footer + "\n\n" : ""}Reply 1, 2, or 3.`
}

// "business_2" -> "Business - 2 pickups/week"
function monthlyPlanLabel(planId) {
  const [category, n] = String(planId).split("_")
  const c = MONTHLY_PLANS[category]
  if (!c) return String(planId).toUpperCase()
  return `${c.title} - ${n} pickup${n === "1" ? "" : "s"}/week`
}

const PICKUP_TIME_WINDOWS = {
  1: "Morning (8am-12pm)",
  2: "Afternoon (12pm-4pm)",
  3: "Evening (4pm-7pm)",
}

const PICKUP_SERVICE_LABELS = {
  instant: "Instant Pickup",
  scheduled: "Scheduled Pickup",
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
 * SETUP REQUIRED — create these approved templates (category Utility) in
 * WhatsApp Manager > Message templates (or in Flaxxa). notifyCustomer()
 * sends them through Meta's Cloud API first and Flaxxa second:
 *
 *   1. name: "driver_assigned"   language: en_US
 *      body: "Good news! {{1}} has been assigned to your pickup on {{2}}."
 *      ({{1}} is sent as "a WasteCore collector"; collector names stay private.)
 *
 *   2. name: "pickup_completed"  language: en_US
 *      body: "Your pickup scheduled for {{1}} has been completed. Thank you for choosing WasteCore."
 *
 * If you use different names, set WAPI_TEMPLATE_ASSIGNED and
 * WAPI_TEMPLATE_COMPLETED. When a template can't be sent the customer gets
 * a plain message instead (delivered if they messaged in the last 24 hours).
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
// Template names as created in the Flaxxa dashboard (see above).
const TEMPLATE_ASSIGNED = process.env.WAPI_TEMPLATE_ASSIGNED || "driver_assigned"
const TEMPLATE_COMPLETED = process.env.WAPI_TEMPLATE_COMPLETED || "pickup_completed"

// Flaxxa answers 200 even for some failures, so check the body too.
const templateSent = (data) =>
  Boolean(data) && !data.error && data.status !== false && data.status !== "error" && data.success !== false

// Sends an approved template straight through Meta's Cloud API (the same
// token as the Pay button), so it works even if Flaxxa blocks template
// sending. Templates are created in WhatsApp Manager > Message templates.
// Tries "English (US)" then "English", whichever the template was made in.
async function sendMetaTemplate(to, templateName, params) {
  const numberId = whatsAppNumberId()
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  const phone = normalizePhone(to).replace(/\D/g, "")
  if (!numberId || !token || !phone) return false
  for (const code of ["en_US", "en"]) {
    try {
      const res = await axios.post(
        `https://graph.facebook.com/v19.0/${numberId}/messages`,
        {
          messaging_product: "whatsapp",
          to: phone,
          type: "template",
          template: {
            name: templateName,
            language: { code },
            components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: String(text ?? "") })) }],
          },
        },
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, timeout: 15000 }
      )
      if (res.data?.messages?.[0]?.id) {
        console.log(`Template "${templateName}" (${code}) sent to ${phone} via Meta`)
        return true
      }
    } catch (err) {
      console.error(`Meta template "${templateName}" (${code}) failed:`, err.response?.data?.error?.message || err.message)
    }
  }
  return false
}

// Sends an approved template (through Meta, then Flaxxa); if neither works
// (e.g. the template isn't approved yet) falls back to a plain message,
// which still reaches customers who messaged the bot in the last 24 hours.
// Returns "template", "text" (sent as a plain message) or "failed".
async function notifyCustomer(phone, templateName, params, fallbackText) {
  if (await sendMetaTemplate(phone, templateName, params)) return "template"
  const data = await sendWhatsAppTemplate(phone, templateName, "en_US", [
    { type: "body", parameters: params.map((text) => ({ type: "text", text: String(text ?? "") })) },
  ])
  if (templateSent(data)) return "template"
  console.warn(`Template "${templateName}" not sent to ${phone}; sending a plain message instead.`)
  return (await sendWhatsAppMessage(phone, fallbackText)) ? "text" : "failed"
}

// Bookings paid by Paystack (or a bank transfer an admin has checked)
// count as paid; receipt photos nobody has checked yet do not.
const paymentVerified = (data) => data.paymentMethod === "paystack" || data.paymentStatus === "paid"

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
            // An admin verified a bank-transfer receipt after the pickup was
            // completed: mark its invoice paid.
            if (paymentVerified(data) && data.invoiceStatus === "awaiting_verification") {
              const invoices = await db.collection("invoices").where("relatedPickupId", "==", change.doc.id).get()
              await Promise.all(invoices.docs.map((inv) => inv.ref.update({ status: "paid", updatedAt: new Date().toISOString() })))
              await change.doc.ref.update({ invoiceStatus: "paid" })
            }

            // Only notify on a status change. Other edits (e.g. reassigning a
            // collector) also fire "modified" and must not re-send messages
            // or create duplicate invoices.
            if (data.status === data.notifiedStatus) return
            await change.doc.ref.update({ notifiedStatus: data.status ?? null })

            const date = data.pickupDate ? displayDate(data.pickupDate) : null
            const isPickup = collectionName === "instantPickups" || collectionName === "pickupRequests"

            // "confirmed" is the older name for "assigned" on scheduled pickups
            // (waste bag orders also use "confirmed", but get no collector).
            if (isPickup && (data.status === "assigned" || data.status === "confirmed")) {
              await notifyCustomer(
                data.customerPhone,
                TEMPLATE_ASSIGNED,
                // Collector details are admin-only; never sent to customers.
                ["a WasteCore collector", date || "the agreed date"],
                `\u{1F69B} *Collector assigned*\n\nA WasteCore collector has been assigned to your pickup${date ? ` on ${date}` : ""}. ` +
                `We'll message you when it's done.`
              )
            }

            if (data.status === "completed") {
              await notifyCustomer(
                data.customerPhone,
                TEMPLATE_COMPLETED,
                [date || "today"],
                `\u2705 *Pickup completed*\n\nYour pickup${date ? ` on ${date}` : ""} has been completed. Thank you for choosing WasteCore! \u267B\uFE0F`
              )
              const verified = paymentVerified(data)
              await db.collection("invoices").add({
                customerPhone: data.customerPhone,
                amount: data.totalAmount ?? SERVICE_PRICES[data.serviceType] ?? 0,
                status: verified ? "paid" : "awaiting_verification",
                paymentMethod: data.paymentMethod ?? null,
                relatedPickupId: change.doc.id,
                relatedCollection: collectionName,
                createdAt: new Date().toISOString(),
              })
              if (!verified) await change.doc.ref.update({ invoiceStatus: "awaiting_verification" })
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
  setupSubscriberWelcome()
}

// ================= SUBSCRIBERS ADDED ON THE DASHBOARD =================
// When an admin registers a subscriber with "Send WhatsApp confirmation"
// ticked, the dashboard saves sendWhatsAppConfirmation: true. The bot sends
// the message once and records the outcome in whatsAppConfirmation, which
// the dashboard shows. "Send again" clears it to resend.
//
// Customers added by hand have usually never messaged the bot, so this
// needs an approved template (WAPI_TEMPLATE_SUBSCRIPTION):
//   name: "subscription_confirmed"   language: en_US   category: Utility
//   body: "Hello {{1}}, your WasteCore {{2}} subscription is now active.
//          Pickups: {{3}}, starting {{4}}. Reply HI anytime to book or get help."
const TEMPLATE_SUBSCRIPTION = process.env.WAPI_TEMPLATE_SUBSCRIPTION || "subscription_confirmed"

const SUBSCRIPTION_TIME_WINDOWS = {
  morning: "Morning (8am-12pm)",
  afternoon: "Afternoon (12pm-4pm)",
  evening: "Evening (4pm-7pm)",
}

// Numbers typed on the dashboard ("0803 123 4567", "+234803...") as the
// bot's WhatsApp id ("whatsapp:+234803..."). Nigerian numbers by default.
function subscriberWhatsAppId(raw) {
  let digits = String(raw || "").replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("0")) digits = `234${digits.slice(1)}`
  else if (digits.length === 10 && !digits.startsWith("0")) digits = `234${digits}`
  return digits.length >= 10 && digits.length <= 15 ? `whatsapp:+${digits}` : null
}

function subscriptionPlanText(planId) {
  const [category, n] = String(planId).split("_")
  const plan = MONTHLY_PLANS[category]
  if (plan?.prices[n]) return { label: monthlyPlanLabel(planId).replace(" - ", " plan \u00B7 "), price: `${naira(plan.prices[n])}/month` }
  if (WEEKLY_PLAN_LABELS[planId]) return { label: `Weekly plan \u00B7 ${WEEKLY_PLAN_LABELS[planId]}`, price: `${naira(SERVICE_PRICES[planId])}/week` }
  const price = SERVICE_PRICES[`upgrade_${planId}`]
  return { label: `${String(planId).charAt(0).toUpperCase()}${String(planId).slice(1)} plan`, price: price ? `${naira(price)}/month` : "" }
}

// "Mon, Wed & Fri"
const joinDays = (days) => days.length === 7 ? "Every day"
  : days.length > 1 ? `${days.slice(0, -1).join(", ")} & ${days[days.length - 1]}` : days.join("")

async function sendSubscriptionConfirmation(data) {
  const phone = subscriberWhatsAppId(data.customerPhone)
  if (!phone) return "invalid_phone"
  const plan = subscriptionPlanText(data.planId)
  const days = Array.isArray(data.pickupDays) ? data.pickupDays : []
  const time = SUBSCRIPTION_TIME_WINDOWS[data.timeWindow]
  const schedule = days.length ? `${joinDays(days)}${time ? `, ${time}` : ""}` : "to be confirmed"
  const start = data.startDate ? displayDate(data.startDate) : "soon"
  const name = String(data.customerName || "").trim()

  // Returning customers are greeted by name when they next message the bot.
  const isBusiness = String(data.planId).startsWith("business")
  const profile = await loadCustomer(phone).catch(() => null)
  if (name && !(isBusiness ? profile?.businessName : profile?.name)) {
    await saveCustomer(phone, isBusiness ? { businessName: name } : { name }).catch(() => {})
  }

  return notifyCustomer(
    phone,
    TEMPLATE_SUBSCRIPTION,
    [name || "there", plan.label, schedule, start],
    [
      `\u2705 *Your WasteCore subscription is active!*`,
      "",
      `Hello ${name || "there"},`,
      "",
      `*${plan.label}*`,
      ...(data.address ? [`\u{1F4CD} ${data.address}`] : []),
      `\u{1F5D3} Pickups: ${schedule}`,
      `\u{1F4C5} Starts ${start}`,
      ...(plan.price ? [`\u{1F4B0} ${plan.price}`] : []),
      "",
      "Reply *hi* anytime to book another service or talk to support.",
    ].join("\n")
  )
}

function setupSubscriberWelcome() {
  db.collection("subscribers").onSnapshot(
    (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === "removed") return
        const data = change.doc.data()
        if (data.sendWhatsAppConfirmation !== true || data.whatsAppConfirmation || data.status !== "active") return
        try {
          // Claim it first (fails if the document changed since), so a
          // repeated snapshot can never send the message twice.
          await change.doc.ref.update(
            { whatsAppConfirmation: { status: "sending", at: new Date().toISOString() } },
            { lastUpdateTime: change.doc.updateTime }
          )
        } catch {
          return
        }
        let status
        try {
          status = await sendSubscriptionConfirmation(data)
        } catch (err) {
          console.error(`Subscription confirmation failed for ${change.doc.id}:`, err)
          status = "failed"
        }
        await change.doc.ref.update({
          whatsAppConfirmation: { status, at: new Date().toISOString() },
        }).catch((err) => console.error("Could not record confirmation status:", err))
      })
    },
    (err) => console.error("Snapshot listener error on subscribers:", err)
  )
}

// ================= HELPERS =================
// ================= CUSTOMER PROFILES =================
// Saved per WhatsApp number so returning customers aren't asked their name
// again. Document id = phone digits.
const customerId = (from) => normalizePhone(from).replace(/\D/g, "")

async function loadCustomer(from) {
  const ref = db.collection("customers").doc(customerId(from))
  const snap = await ref.get()
  if (snap.exists) return snap.data()

  // Customers who booked before profiles existed: reuse the name from a
  // past booking so they aren't asked again.
  for (const col of ["instantPickups", "pickupRequests", "upgradeRequests", "wasteBagOrders"]) {
    const past = await db.collection(col).where("customerPhone", "==", from).limit(1).get()
    const name = past.empty ? null : past.docs[0].data().customerName
    if (name) {
      const profile = { name, createdAt: new Date().toISOString() }
      await ref.set(profile, { merge: true })
      return profile
    }
  }
  return null
}

async function saveCustomer(from, fields) {
  await db.collection("customers").doc(customerId(from)).set(
    { ...fields, phone: normalizePhone(from), updatedAt: new Date().toISOString() },
    { merge: true }
  )
}

// ================= ABOUT WASTECORE =================
// Menu option 6. The text below is sent first, then every picture or video
// in public/about/ (in filename order, e.g. 1-flyer.jpg, 2-how-it-works.mp4),
// then the menu again. To change them, add or remove files in that folder;
// captions are optional and keyed by filename in ABOUT_CAPTIONS.
// WhatsApp limits: pictures JPG/PNG up to 5 MB, videos MP4 up to 16 MB.
const ABOUT_TEXT = [
  "\u267B\uFE0F *About WasteCore*",
  "",
  "We collect bagged waste from homes and businesses across Yenagoa and dispose of it responsibly. " +
    "You book, pay and get updates right here on WhatsApp.",
  "",
  "\u{1F69B} *Instant Pickup* \u2014 we come as soon as possible.",
  "\u{1F4C5} *Scheduled Pickup* \u2014 you choose the date and time window.",
  "_Both are priced per bag; you see the total before you pay._",
  "",
  "\u{1F5D3} *Monthly Subscription* \u2014 regular pickups every week.",
  `   \u2022 Household: from ${"\u20A6"}${MONTHLY_PLANS.household.prices[1].toLocaleString()}/month`,
  `   \u2022 Business: from ${"\u20A6"}${MONTHLY_PLANS.business.prices[1].toLocaleString()}/month`,
  "",
  "\u{1F6CD} *Waste Bags* \u2014 packs of 10, delivered to you.",
  "\u{1F4AC} *Support* \u2014 talk to our team about anything.",
  "",
  "\u{1F4B3} Pay securely by card, bank transfer or USSD.",
].join("\n")

const ABOUT_CAPTIONS = {
  "1-flyer.jpg": "Reliable, on-time, affordable waste pickup for homes and businesses in Yenagoa.",
  "2-how-it-works.mp4": "How WasteCore works: book, pay and get your waste picked up, all on WhatsApp.",
  "3-cart-scan-to-book.jpg": "Spot our green carts around Yenagoa. Scan the QR code to book a pickup.",
  "4-cart.jpg": "Save our number: +234 811 750 1757",
}

const ABOUT_DIR = require("path").join(__dirname, "public", "about")
const MAX_ABOUT_MEDIA = 6
const isVideo = (file) => /\.mp4$/i.test(file)

function aboutMedia() {
  try {
    return require("fs").readdirSync(ABOUT_DIR)
      .filter((f) => /\.(jpe?g|png|mp4)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .slice(0, MAX_ABOUT_MEDIA)
  } catch {
    return []
  }
}

/**
 * Sends a picture or video by public URL through Meta's Cloud API (same
 * token and number as the Pay button). Returns false if it couldn't be sent.
 */
async function sendWhatsAppMedia(to, { type, url, caption, phoneNumberId }) {
  const numberId = whatsAppNumberId(phoneNumberId)
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  const phone = normalizePhone(to).replace(/\D/g, "")
  if (!numberId || !token || !phone) return false
  try {
    const res = await axios.post(
      `https://graph.facebook.com/v19.0/${numberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone,
        type,
        [type]: { link: url, ...(caption ? { caption: caption.slice(0, 1024) } : {}) },
      },
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, timeout: 15000 }
    )
    return Boolean(res.data?.messages?.[0]?.id)
  } catch (err) {
    console.error(`WhatsApp ${type} message failed:`, err.response?.data || err.message)
    return false
  }
}

// ================= WHATSAPP BUTTON MESSAGES =================
/**
 * Sends a message with a tappable URL button (WhatsApp "cta_url"
 * interactive message) straight through Meta's Cloud API, using the same
 * WHATSAPP_ACCESS_TOKEN the bot uses to download receipt photos.
 * Returns false if it can't be sent (no token/number ID, or Meta rejects
 * it) so the caller can fall back to a plain text message with the link.
 */
async function sendWhatsAppUrlButton(to, { body, buttonText, url, footer, phoneNumberId }) {
  const numberId = whatsAppNumberId(phoneNumberId)
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  const phone = normalizePhone(to).replace(/\D/g, "")
  if (!numberId || !token || !phone) return false
  try {
    const res = await axios.post(
      `https://graph.facebook.com/v19.0/${numberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone,
        type: "interactive",
        interactive: {
          type: "cta_url",
          body: { text: body.slice(0, 1024) },
          ...(footer ? { footer: { text: footer.slice(0, 60) } } : {}),
          action: { name: "cta_url", parameters: { display_text: buttonText.slice(0, 20), url } },
        },
      },
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, timeout: 15000 }
    )
    return Boolean(res.data?.messages?.[0]?.id)
  } catch (err) {
    console.error("WhatsApp button message failed, sending link as text:", err.response?.data || err.message)
    return false
  }
}

// ================= CHECKOUT =================
const BANK_DETAILS =
  `Bank: Moniepoint\nAccount Name: WasteCore Limited\nAccount Number: 6614999315`

// ---- Message formatting (WhatsApp supports *bold* and emoji) ----
const naira = (n) => `\u20A6${Number(n).toLocaleString()}`

// Names arrive lowercased from the parser; "franklyn ade" -> "Franklyn Ade".
const displayName = (name) =>
  String(name || "").replace(/\b\w/g, (c) => c.toUpperCase())

// "2026-10-27" -> "27 Oct 2026"
function displayDate(iso) {
  const d = new Date(`${iso}T00:00:00`)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

// Today's date in Nigeria as YYYY-MM-DD (the server clock runs on UTC).
const lagosToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date())

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Reads a date the way customers type it: "2026-03-30", "30/03/2026",
// "30-3-2026", "today" or "tomorrow". Day comes first, as in Nigeria.
// Returns YYYY-MM-DD, or null if it isn't a real date.
function parseDateInput(text) {
  const t = String(text || "").trim().toLowerCase()
  if (t === "today") return lagosToday()
  if (t === "tomorrow") return addDays(lagosToday(), 1)
  let y, m, d
  let match = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (match) [, y, m, d] = match
  else if ((match = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [, d, m, y] = match
  else return null
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  const check = new Date(`${iso}T00:00:00Z`)
  // Rejects dates like 31/02 that JavaScript would roll over into March.
  return !isNaN(check.getTime()) && check.toISOString().slice(0, 10) === iso ? iso : null
}

const bagsText = (n) => `${n} bag${n > 1 ? "s" : ""}`
const DIVIDER = "\u2501".repeat(14)

// Everything needed to charge for and save the booking a conversation has
// built up: where it is saved, the document, the amount, and the messages.
// Used by both Paystack and the bank-transfer + receipt fallback.
// `details` are the order lines shown before payment and in the confirmation.
function buildCheckout(d, from) {
  if (String(d.serviceType).startsWith("upgrade_")) {
    const label = monthlyPlanLabel(d.upgradePlan)
    const amount = SERVICE_PRICES[d.serviceType]
    return {
      collection: "upgradeRequests",
      amount,
      description: `${label} (monthly)`,
      title: `${label.replace(" - ", " plan \u00B7 ")}`,
      details: [
        ...(d.planCategory === "business" && d.businessName ? [`\u{1F3E2} ${d.businessName}`] : []),
        `\u{1F4CD} ${d.address}`,
        `\u{1F4C5} Starts ${displayDate(d.startDate)}`,
      ],
      totalText: `${naira(amount)}/month`,
      doc: {
        // Business plans are booked under the business name.
        customerName: d.planCategory === "business" ? (d.businessName || d.name) : d.name,
        businessName: d.planCategory === "business" ? (d.businessName ?? null) : null,
        contactName: d.name ?? null,
        customerPhone: from, address: d.address,
        plan: d.upgradePlan, planCategory: d.planCategory ?? null, planLabel: label,
        serviceType: d.serviceType, startDate: d.startDate, totalAmount: amount,
      },
      doneTitle: "Payment received. Your subscription is confirmed!",
      nextSteps: "Our team will activate your plan within 24 hours.",
    }
  }

  if (d.serviceType === "wasteBags") {
    const size = d.bagSize.charAt(0).toUpperCase() + d.bagSize.slice(1)
    return {
      collection: "wasteBagOrders",
      amount: d.bagTotal,
      description: `${d.bagSize} waste bags x ${d.bagQuantity} pack(s)`,
      title: "Waste bags",
      details: [
        `\u{1F6CD} ${size} bags \u00D7 ${d.bagQuantity} pack${d.bagQuantity > 1 ? "s" : ""}`,
        `\u{1F4CD} Deliver to: ${d.address}`,
      ],
      totalText: naira(d.bagTotal),
      doc: {
        customerName: d.name, customerPhone: from, bagSize: d.bagSize, quantity: d.bagQuantity,
        totalAmount: d.bagTotal, deliveryAddress: d.address, serviceType: "wasteBags",
      },
      doneTitle: "Payment received. Your order is confirmed!",
      nextSteps: "Expect delivery within 1-2 business days.",
    }
  }

  // Instant / scheduled pickup (and retired flat-price weekly sessions)
  const serviceLabel = PICKUP_SERVICE_LABELS[d.serviceType] || WEEKLY_PLAN_LABELS[d.serviceType] || d.serviceType
  const amount = d.totalAmount ?? SERVICE_PRICES[d.serviceType]
  const when = `\u{1F4C5} ${displayDate(d.pickupDate)}${d.timeWindow ? ` \u00B7 ${d.timeWindow}` : ""}`
  return {
    collection: d.serviceType === "instant" ? "instantPickups" : "pickupRequests",
    amount,
    description: `${serviceLabel}${d.bagCount ? ` - ${bagsText(d.bagCount)}` : ""}`,
    title: serviceLabel,
    details: [
      ...(d.bagCount ? [`\u{1F6CD} ${bagsText(d.bagCount)} \u00D7 ${naira(d.pricePerBag)}`] : []),
      `\u{1F4CD} ${d.address}`,
      when,
    ],
    totalText: naira(amount),
    doc: {
      customerName: d.name, customerPhone: from, address: d.address,
      wasteType: d.wasteType ?? null, pickupDate: d.pickupDate, timeWindow: d.timeWindow ?? null,
      bagCount: d.bagCount ?? null, pricePerBag: d.pricePerBag ?? null, totalAmount: amount ?? null,
      serviceType: d.serviceType, serviceLabel,
    },
    doneTitle: "Payment received. You're booked!",
    nextSteps: "We'll message you when a collector is assigned.",
  }
}

// Order summary card shown before payment.
function orderSummary(c) {
  return [`\u{1F9FE} *${c.title}*`, ...c.details, DIVIDER, `\u{1F4B0} *Total: ${c.totalText}*`].join("\n")
}

// Message sent once the booking is saved. Paystack payments are verified;
// a receipt photo is only received, so it isn't called "payment received".
function confirmationMessage(c, { viaReceipt = false } = {}) {
  const title = viaReceipt ? c.doneTitle.replace(/^Payment received\./, "Receipt received.") : c.doneTitle
  return [
    `\u2705 *${title}*`,
    "",
    `*${c.title}*`,
    ...c.details,
    viaReceipt ? `\u{1F4B0} Amount: ${c.totalText}` : `\u{1F4B0} Paid: ${c.totalText}`,
    "",
    c.nextSteps,
    "Reply *hi* anytime to make another booking.",
  ].join("\n")
}

// Saves a paid booking. Shared by the receipt flow and Paystack.
function bookingRecord(checkout, payment) {
  const now = new Date().toISOString()
  return { ...checkout.doc, ...payment, status: "pending", createdAt: now, updatedAt: now }
}

// ================= PAYSTACK =================
// Enabled when PAYSTACK_SECRET_KEY is set. Customers get a payment link;
// the booking is created only after Paystack confirms the payment (webhook
// or the return page), so unpaid bookings never reach the dashboard.
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY
const PAYSTACK_API = "https://api.paystack.co"
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "")
const PAYSTACK_EMAIL_DOMAIN = process.env.PAYSTACK_CUSTOMER_EMAIL_DOMAIN || "customers.wastecore.ng"
// Business WhatsApp number for the "Back to WhatsApp" button (digits only):
// WHATSAPP_BUSINESS_NUMBER if set, otherwise the number customers actually
// message, learnt from incoming webhooks and saved in config/whatsapp.
const DEFAULT_BUSINESS_NUMBER = "2348117501757"
let learnedBusinessNumber = null
// Meta's ID for the bot's number, needed to send through the Cloud API when
// there's no incoming message to take it from (e.g. status updates).
let learnedPhoneNumberId = null

function whatsAppNumberId(fromWebhook) {
  return process.env.WHATSAPP_PHONE_NUMBER_ID || fromWebhook || learnedPhoneNumberId || null
}

function businessNumber() {
  return (process.env.WHATSAPP_BUSINESS_NUMBER || learnedBusinessNumber || DEFAULT_BUSINESS_NUMBER).replace(/\D/g, "")
}

async function loadBusinessNumber() {
  try {
    const snap = await db.collection("config").doc("whatsapp").get()
    if (snap.exists && snap.data().displayNumber) learnedBusinessNumber = snap.data().displayNumber
    if (snap.exists && snap.data().phoneNumberId) learnedPhoneNumberId = snap.data().phoneNumberId
  } catch (err) {
    console.error("Could not load the saved WhatsApp number:", err.message)
  }
}

async function rememberBusinessNumber(displayNumber, phoneNumberId) {
  const digits = String(displayNumber || "").replace(/\D/g, "")
  const numberId = phoneNumberId ? String(phoneNumberId) : null
  if ((!digits || digits === learnedBusinessNumber) && (!numberId || numberId === learnedPhoneNumberId)) return
  if (digits) learnedBusinessNumber = digits
  if (numberId) learnedPhoneNumberId = numberId
  await db.collection("config").doc("whatsapp").set({
    ...(digits ? { displayNumber: digits } : {}),
    ...(numberId ? { phoneNumberId: numberId } : {}),
    updatedAt: new Date().toISOString(),
  }, { merge: true })
}

const paystackEnabled = () => Boolean(PAYSTACK_SECRET_KEY)

function newPaymentReference() {
  return `WC-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`.toUpperCase()
}

// Stores the booking as pending and returns a Paystack checkout link, or
// null if Paystack could not be reached (the caller falls back to bank
// transfer).
async function createPaystackPayment(checkout, from) {
  const reference = newPaymentReference()
  const phoneDigits = normalizePhone(from).replace(/\D/g, "")
  try {
    await db.collection("pendingPayments").doc(reference).set({
      collection: checkout.collection,
      doc: checkout.doc,
      amount: checkout.amount,
      confirmation: confirmationMessage(checkout),
      customerPhone: from,
      status: "pending",
      createdAt: new Date().toISOString(),
    })
    const res = await axios.post(
      `${PAYSTACK_API}/transaction/initialize`,
      {
        // Paystack requires an email; WhatsApp customers don't give one.
        email: `${phoneDigits}@${PAYSTACK_EMAIL_DOMAIN}`,
        amount: Math.round(checkout.amount * 100), // kobo
        currency: "NGN",
        reference,
        ...(PUBLIC_BASE_URL ? { callback_url: `${PUBLIC_BASE_URL}/paystack/callback` } : {}),
        metadata: {
          customerPhone: normalizePhone(from),
          custom_fields: [
            { display_name: "Service", variable_name: "service", value: checkout.description },
            { display_name: "WhatsApp", variable_name: "whatsapp", value: normalizePhone(from) },
          ],
        },
      },
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }, timeout: 15000 }
    )
    return res.data?.data?.authorization_url || null
  } catch (err) {
    console.error("Paystack initialize failed:", err.response?.data || err.message)
    await db.collection("pendingPayments").doc(reference).update({ status: "init_failed" }).catch(() => {})
    return null
  }
}

// Turns a confirmed payment into a booking exactly once (duplicate webhooks
// and the return page can both arrive) and messages the customer.
async function finalizePaystackPayment(reference, paidKobo, channel, customerPhone) {
  const pendingRef = db.collection("pendingPayments").doc(reference)
  const result = await db.runTransaction(async (t) => {
    const snap = await t.get(pendingRef)
    if (!snap.exists) return { outcome: "unknown" }
    const p = snap.data()
    if (p.status === "paid") return { outcome: "already_paid" }
    if (Number(paidKobo) !== Math.round(p.amount * 100)) {
      t.update(pendingRef, { status: "amount_mismatch", paidKobo: Number(paidKobo), updatedAt: new Date().toISOString() })
      return { outcome: "amount_mismatch", p }
    }
    // A link paid days later can carry a pickup/start date that has passed.
    // The money is real, so the booking is still made, flagged for the team
    // to agree a new date with the customer.
    const bookedDate = p.doc?.pickupDate || p.doc?.startDate
    const datePassed = Boolean(bookedDate) && bookedDate < lagosToday()
    const bookingRef = db.collection(p.collection).doc()
    t.set(bookingRef, bookingRecord(p, {
      paymentMethod: "paystack",
      paymentReference: reference,
      paymentChannel: channel || null,
      paymentStatus: "paid",
      paidAt: new Date().toISOString(),
      ...(datePassed ? { needsReschedule: true } : {}),
    }))
    t.update(pendingRef, { status: "paid", bookingCollection: p.collection, bookingId: bookingRef.id, paidAt: new Date().toISOString() })
    return { outcome: "created", p, datePassed, bookedDate }
  })

  if (result.outcome === "created") {
    const message = result.datePassed
      ? `${result.p.confirmation}\n\n\u26A0\uFE0F The date you chose (${displayDate(result.bookedDate)}) has already passed, ` +
        `so our team will contact you to agree a new date.`
      : result.p.confirmation
    await sendWhatsAppMessage(result.p.customerPhone, message)
  } else if (result.outcome === "unknown" && String(reference).startsWith("WC-")) {
    await reportUnmatchedPayment(reference, paidKobo, customerPhone)
  } else if (result.outcome === "amount_mismatch") {
    console.error(`Paystack amount mismatch for ${reference}: paid ${paidKobo} kobo, expected ${result.p.amount * 100}`)
    await sendWhatsAppMessage(result.p.customerPhone,
      "We received a payment that doesn't match your booking total. Our team will contact you shortly.")
  }
  return result.outcome
}

// A bot payment whose booking record is gone (e.g. a link paid long after
// it was cleaned up). Raises one support ticket so the team can follow up.
async function reportUnmatchedPayment(reference, paidKobo, customerPhone) {
  const phone = customerPhone ? `whatsapp:+${String(customerPhone).replace(/\D/g, "")}` : null
  try {
    await db.collection("supportTickets").doc(`payment_${reference}`).create({
      ticketId: `PAY-${reference.slice(-6)}`,
      customerName: "",
      customerPhone: phone,
      category: "Payment without booking",
      message: `Paystack payment ${reference} of ${naira(Number(paidKobo) / 100)} could not be matched to a booking. Contact the customer to rebook.`,
      contactTime: "anytime",
      status: "open",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  } catch (err) {
    if (err.code === 6) return // already reported (webhook and return page both arrive)
    throw err
  }
  console.error(`Paystack payment ${reference} has no matching booking; support ticket raised.`)
  if (phone) {
    await sendWhatsAppMessage(phone,
      `We received your payment of ${naira(Number(paidKobo) / 100)} (ref ${reference}), but the booking it was for has expired. ` +
      `Our team will contact you shortly to set it up. No need to pay again.`)
  }
}

async function verifyPaystackTransaction(reference) {
  const res = await axios.get(`${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    timeout: 15000,
  })
  return res.data?.data
}

// ================= HOUSEKEEPING =================
// Old duplicate-message markers and payment links that were never paid
// would otherwise pile up in Firestore forever.
const DAY_MS = 24 * 60 * 60 * 1000

async function deleteOlderThan(collectionName, field, days, keep = () => false) {
  const cutoff = new Date(Date.now() - days * DAY_MS).toISOString()
  const snap = await db.collection(collectionName).where(field, "<", cutoff).limit(400).get()
  const stale = snap.docs.filter((d) => !keep(d.data()))
  if (!stale.length) return 0
  const batch = db.batch()
  stale.forEach((d) => batch.delete(d.ref))
  await batch.commit()
  return stale.length
}

async function cleanUpOldRecords() {
  try {
    const messages = await deleteOlderThan("processedMessages", "processedAt", 3)
    // Paid links are kept: they link a Paystack payment to its booking.
    const links = await deleteOlderThan("pendingPayments", "createdAt", 30, (p) => p.status === "paid" || p.status === "amount_mismatch")
    if (messages || links) console.log(`Cleanup: removed ${messages} old message markers, ${links} unpaid payment links`)
  } catch (err) {
    console.error("Cleanup failed:", err.message)
  }
}

// ================= START SERVER =================
nextApp.prepare().then(() => {
  const app = express()

  const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())

  // The dashboard is served by this same server, so its own requests are
  // always allowed; FRONTEND_URL only lists *other* sites that may call in.
  // Browsers send an Origin header on POST/PATCH/DELETE even when same-site.
  function isSameOrigin(req, origin) {
    try {
      const { host } = new URL(origin)
      const forwarded = (req.headers["x-forwarded-host"] || "").split(",")[0].trim()
      return host === req.headers.host || (forwarded && host === forwarded)
    } catch {
      return false
    }
  }

  app.use(
    cors((req, callback) => {
      const origin = req.headers.origin
      const allowed = !origin || allowedOrigins.includes(origin) || isSameOrigin(req, origin)
      if (allowed) callback(null, { origin: true, credentials: true })
      else callback(new Error(`CORS: origin ${origin} not allowed`))
    })
  )
  app.use(bodyParser.urlencoded({ extended: false }))
  // Keep the raw body: Paystack signs the exact bytes it sends.
  app.use(bodyParser.json({ verify: (req, _res, buf) => { req.rawBody = buf } }))

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
      ).toString().trim().substring(0, 1000)

      // Receipt — a photo, or a file such as a PDF bank receipt. Meta sends
      // a media ID, not a URL; the bytes are fetched via the Graph API.
      const docMime = String(message.document?.mime_type || "").toLowerCase()
      const isReceiptDocument = msgType === "document" && (docMime === "application/pdf" || docMime.startsWith("image/"))
      const hasImage = msgType === "image" || isReceiptDocument
      const mediaId  = msgType === "image" ? message.image?.id || null
        : isReceiptDocument ? message.document?.id || null
        : null
      // Any other file (Word, audio...) can't be used as a receipt.
      const unsupportedMedia = !hasImage && ["document", "audio", "video", "sticker"].includes(msgType)
      const mediaType = isReceiptDocument && docMime === "application/pdf" ? "pdf" : "image"

      const messageId = message.id || null
      // `msg` is lowercased for matching commands and menu choices; `rawMsg`
      // keeps what the customer typed for names, addresses and descriptions.
      const phoneNumberId = value?.metadata?.phone_number_id || null
      const displayNumber = value?.metadata?.display_phone_number || null
      return {
        from: normalizedFrom, msg: text.toLowerCase().substring(0, 500), rawMsg: text,
        hasImage, mediaId, mediaType, unsupportedMedia, messageId, phoneNumberId, displayNumber,
      }
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

  async function uploadImageToCloudinary(imageBuffer, from, mediaType = "image") {
    return new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            folder: "waste-connect/receipts",
            // Cloudinary stores PDFs as "image" assets, so the dashboard
            // can show a preview of the first page.
            resource_type: "image",
            ...(mediaType === "pdf" ? { format: "pdf" } : {}),
            public_id: `receipt_${from.replace(/whatsapp:\+?/i, "")}_${Date.now()}`,
          },
          (error, result) => (error ? reject(error) : resolve(result.secure_url))
        )
        .end(imageBuffer)
    })
  }

  // Firestore documents are capped at 1 MB, so only small files fit in the
  // backup copy (base64 grows the size by a third).
  const MAX_FALLBACK_BYTES = 700 * 1024

  async function uploadImageFallback(imageBuffer, from) {
    if (imageBuffer.length > MAX_FALLBACK_BYTES) throw new Error("Receipt too large for the backup copy")
    const base64Image = imageBuffer.toString("base64")
    const docId = `receipt_${from.replace(/whatsapp:\+?/i, "")}_${Date.now()}`
    await db.collection("imageFallbacks").doc(docId).set({
      imageData: base64Image,
      customerNumber: from,
      uploadedAt: new Date().toISOString(),
    })
    return `firebase:${docId}`
  }

  // Returns the saved receipt's URL, or null if it couldn't be downloaded
  // or stored (the customer is then asked to send it again).
  async function handleReceiptUpload(mediaId, from, mediaType) {
    let buffer
    try {
      buffer = await downloadMetaMedia(mediaId)
    } catch (err) {
      console.error("Receipt download from WhatsApp failed:", err.response?.data || err.message)
      return null
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await uploadImageToCloudinary(buffer, from, mediaType)
      } catch (err) {
        console.error(`Cloudinary upload attempt ${attempt} failed:`, err.message || err)
      }
    }
    try {
      return await uploadImageFallback(buffer, from)
    } catch (err) {
      console.error("Receipt backup save failed:", err.message)
      return null
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
  // Messages from the same customer are handled one at a time, in order, so
  // two quick messages can't both act on the same step of the conversation.
  const senderQueues = new Map()
  function runInOrder(key, task) {
    const next = (senderQueues.get(key) || Promise.resolve()).then(task)
    senderQueues.set(key, next)
    next.finally(() => { if (senderQueues.get(key) === next) senderQueues.delete(key) })
  }

  app.post("/whatsapp", (req, res) => {
    // Acknowledge immediately — Flaxxa expects a fast 200 OK
    res.sendStatus(200)

    const incoming = extractIncoming(req)
    if (!incoming.from) {
      console.warn("Webhook received with no sender phone — ignored.", req.body)
      return
    }
    runInOrder(incoming.from, () =>
      handleIncoming(incoming).catch((err) => console.error("Webhook handling failed:", err))
    )
  })

  // "cancel", "cancel please", "stop", "restart"... but not an address such
  // as "Ojota bus stop".
  const CANCEL_RE = /^(please\s+)?(cancel|stop|restart|quit|exit)(\s+(please|it|this|order|booking|request))?[\s.!]*$/

  // Bookings still in progress, newest first. Queried by phone only (no
  // composite index needed) and filtered by status here.
  const ACTIVE_STATUSES = {
    instantPickups: ["pending", "assigned", "confirmed"],
    pickupRequests: ["pending", "assigned", "confirmed"],
    upgradeRequests: ["pending"],
    wasteBagOrders: ["pending", "confirmed"],
  }

  async function findActiveBookings(from, collections = Object.keys(ACTIVE_STATUSES)) {
    const snaps = await Promise.all(
      collections.map((col) => db.collection(col).where("customerPhone", "==", from).get())
    )
    return snaps
      .flatMap((snap, i) => snap.docs.map((d) => ({ collection: collections[i], id: d.id, ref: d.ref, data: d.data() })))
      .filter((b) => ACTIVE_STATUSES[b.collection].includes(b.data.status))
      .sort((a, b) => String(b.data.createdAt || "").localeCompare(String(a.data.createdAt || "")))
  }

  function bookingLabel(b) {
    const d = b.data
    if (b.collection === "wasteBagOrders") return "Waste bag order"
    return d.serviceLabel || d.planLabel || PICKUP_SERVICE_LABELS[d.serviceType] ||
      WEEKLY_PLAN_LABELS[d.serviceType] || (b.collection === "upgradeRequests" ? "Monthly subscription" : "Pickup")
  }

  async function handleIncoming({
    from, msg, rawMsg = "", hasImage, mediaId, mediaType, unsupportedMedia, messageId, phoneNumberId, displayNumber,
  }) {
    if (displayNumber || phoneNumberId) rememberBusinessNumber(displayNumber, phoneNumberId).catch(() => {})

    // DEDUPLICATION — Flaxxa sometimes sends the same webhook twice.
    // create() fails if the marker exists, so only one copy gets through.
    if (messageId) {
      try {
        await db.collection("processedMessages").doc(messageId).create({ processedAt: new Date().toISOString(), from })
      } catch (err) {
        if (err.code === 6) { // ALREADY_EXISTS
          console.log(`Duplicate webhook ignored — messageId: ${messageId}`)
          return
        }
        throw err
      }
    }

    // GLOBAL CANCEL
    if (CANCEL_RE.test(msg)) {
      await db.collection("sessions").doc(from).delete()
      await sendWhatsAppMessage(from, "Cancelled. Send any message to start again.")
      return
    }

    const sessionsRef = db.collection("sessions").doc(from)
    const sessionDoc = await sessionsRef.get()
    let session = sessionDoc.exists ? sessionDoc.data() : { step: "0", data: {} }

    const send = (text) => sendWhatsAppMessage(from, text)

    // Loads the saved name (and business name) once per conversation.
    const ensureProfile = async () => {
      if (session.data.profileLoaded) return
      const profile = await loadCustomer(from)
      if (profile?.name && !session.data.name) session.data.name = profile.name
      if (profile?.businessName && !session.data.businessName) session.data.businessName = profile.businessName
      session.data.profileLoaded = true
    }

    const sendServiceMenu = async () => {
      await ensureProfile()
      const greeting = session.data.name
        ? `Welcome back, ${displayName(session.data.name)}! \u{1F44B}`
        : "Welcome to WasteCore! \u267B\uFE0F"
      await send(`${greeting}\n\n${SERVICE_MENU}\n\nReply with a number. Type *cancel* anytime to restart.`)
      session.step = "1.5"
    }

    // After a service is picked: monthly plans ask for a name later (business
    // or household); everything else needs the customer's name, asked only
    // if we don't already have it.
    const continueWithService = async () => {
      await ensureProfile()
      if (session.data.serviceType !== "upgrade" && !session.data.name) {
        await send("What is your full name?")
        session.step = "1"
        return
      }
      await beginService()
    }

    // Menu option 6: what WasteCore does, pictures/videos, then the menu again so
    // the customer can book straight away.
    const sendAbout = async () => {
      await send(ABOUT_TEXT)
      const files = PUBLIC_BASE_URL ? aboutMedia() : []
      for (const file of files) {
        await sendWhatsAppMedia(from, {
          type: isVideo(file) ? "video" : "image",
          url: `${PUBLIC_BASE_URL}/about/${encodeURIComponent(file)}`,
          caption: ABOUT_CAPTIONS[file],
          phoneNumberId,
        })
      }
      await send(`Ready to book? \u{1F447}\n\n${SERVICE_MENU}\n\nReply with a number.`)
      session.step = "1.5"
    }

    const showMonthlyPlans = async () => {
      await send(monthlyPlansMenu(session.data.planCategory))
      session.step = "upgrade_select"
    }

    // Sends the first question of the chosen service and moves to its step.
    const beginService = async () => {
      switch (session.data.serviceType) {
        case "upgrade":
          await send(SUBSCRIPTION_CATEGORY_MENU)
          session.step = "plan_category"
          break
        case "wasteBags":
          await send(`Waste Bag Sizes\n\n1 - Small  NGN 500 (pack of 10)\n2 - Medium  NGN 900 (pack of 10)\n3 - Large  NGN 1,500 (pack of 10)\n\nReply 1, 2, or 3.`)
          session.step = "bags_select"
          break
        case "support":
          await send(`Support Categories\n\n1 - Missed Pickup\n2 - Billing Issue\n3 - Driver Complaint\n4 - Change Pickup Date\n5 - Other\n\nReply with a number.`)
          session.step = "support_select"
          break
        default: // instant, scheduled
          await send("Your pickup address?")
          session.step = "pickup_address"
      }
    }

    // Payment: a Paystack link when configured (booking is created once
    // Paystack confirms), otherwise bank transfer + receipt photo.
    const startCheckout = async (receiptStep) => {
      const checkout = buildCheckout(session.data, from)
      if (paystackEnabled()) {
        const link = await createPaystackPayment(checkout, from)
        if (link) {
          const payLabel = `Pay ${naira(checkout.amount)}`
          const sentButton = await sendWhatsAppUrlButton(from, {
            body:
              `Thanks, ${displayName(session.data.name || session.data.businessName)}! Here's your order:\n\n${orderSummary(checkout)}\n\n` +
              `Tap *${payLabel}* below to pay securely by card, bank transfer or USSD. ` +
              `We'll confirm your booking right here as soon as your payment goes through.`,
            buttonText: payLabel,
            url: link,
            footer: "\u{1F512} Secured by Paystack",
            phoneNumberId,
          })
          if (sentButton) {
            session.step = "done"
            return
          }
          await send(
            `Thanks, ${displayName(session.data.name || session.data.businessName)}! Here's your order:\n\n${orderSummary(checkout)}\n\n` +
            `\u{1F447} *Tap the link below to pay ${naira(checkout.amount)}*\n${link}\n\n` +
            `\u{1F4B3} Card  \u00B7  \u{1F3E6} Bank transfer  \u00B7  \u{1F4F1} USSD\n` +
            `\u{1F512} Secured by Paystack\n\n` +
            `We'll confirm your booking right here as soon as your payment goes through.`
          )
          session.step = "done"
          return
        }
      }
      await send(
        `Thanks, ${displayName(session.data.name || session.data.businessName)}! Here's your order:\n\n${orderSummary(checkout)}\n\n` +
        `\u{1F3E6} *Pay by bank transfer*\n${BANK_DETAILS}\n\n` +
        `\u{1F4F8} After paying, send a photo or PDF of your payment receipt here.`
      )
      session.step = receiptStep
    }

    const sendPickupPayment = () => startCheckout("pickup_payment")

    // Per-bag pickups ask for the bag count first; retired flat-price
    // plans go straight to the date.
    const askBagsOrDate = async () => {
      const perBag = PICKUP_PRICE_PER_BAG[session.data.serviceType]
      if (perBag) {
        // The per-bag price is only shown once, in the calculation.
        await send("How many bags of waste do you want to dispose?\n\nReply with a number, e.g. 3.")
        session.step = "pickup_bags"
      } else {
        await askPickupDate()
        session.step = "pickup_date"
      }
    }

    const DATE_HINT = "Reply *today*, *tomorrow* or a date like 30/03/2026."
    const askPickupDate = () => send(
      session.data.serviceType === "scheduled"
        ? `Which date should we come?\n\n${DATE_HINT}`
        : `When should we pick up?\n\n${DATE_HINT}`
    )

    // Reads a date reply; tells the customer what's wrong and returns null
    // if it isn't a valid date from today on.
    const readFutureDate = async () => {
      const date = parseDateInput(msg)
      if (!date) {
        await send(`Sorry, I couldn't read that date. ${DATE_HINT}`)
        return null
      }
      if (date < lagosToday()) {
        await send(`That date has passed. ${DATE_HINT}`)
        return null
      }
      return date
    }

    // Bank-transfer fallback: saves the booking once a receipt photo or PDF
    // arrives. Returns false (staying on the step) if the customer needs to
    // send it again.
    const saveReceiptBooking = async () => {
      if (!hasImage) {
        await send(unsupportedMedia
          ? "That file type can't be used as a receipt. Please send a photo or PDF of your payment receipt."
          : "Please send a photo or PDF of your payment receipt.")
        return false
      }
      const receiptUrl = await handleReceiptUpload(mediaId, from, mediaType)
      if (!receiptUrl) {
        await send("Sorry, we couldn't save your receipt. Please send it again.")
        return false
      }
      const checkout = buildCheckout(session.data, from)
      await db.collection(checkout.collection).add(
        bookingRecord(checkout, { paymentReceiptUrl: receiptUrl, paymentMethod: "bank_transfer", paymentStatus: "unverified" })
      )
      await send(confirmationMessage(checkout, { viaReceipt: true }))
      return true
    }

    try {
      // ── Active request check (only at conversation start) ────────────────
      if (session.step === "0" || session.step === "0.5") {
        const [active] = await findActiveBookings(from)
        if (active) {
          const d = active.data
          const when = d.pickupDate ? `\n\u{1F4C5} ${displayDate(d.pickupDate)}${d.timeWindow ? ` \u00B7 ${d.timeWindow}` : ""}`
            : d.startDate ? `\n\u{1F4C5} Starts ${displayDate(d.startDate)}` : ""
          await ensureProfile()
          await send(
            `${session.data.name ? `Welcome back, ${displayName(session.data.name)}! \u{1F44B}\n\n` : ""}` +
            `You have a booking in progress:\n\n*${bookingLabel(active)}*${when}\nStatus: ${d.status}\n\n` +
            `What would you like to do?\n1 - Book another service\n2 - Order Waste Bags\n3 - Speak to Support\n\nReply with a number.`
          )
          session.step = "active_menu"
          await sessionsRef.set(session)
          return
        }
      }

      // ================= SESSION SWITCH =================
      switch (session.step) {

        // ── ENTRY ──────────────────────────────────────────────────────────
        // Any first message (hi, good morning, a question...) opens the menu.
        case "0":
          await sendServiceMenu()
          break

        // Older conversations waiting at the retired "Book Pickup" prompt.
        case "0.5":
          await sendServiceMenu()
          break

        // ── ACTIVE-REQUEST SIDE MENU ───────────────────────────────────────
        case "active_menu":
          if (msg === "1") {
            await sendServiceMenu()
          } else if (msg === "2") {
            session.data.serviceType = "wasteBags"
            await continueWithService()
          } else if (msg === "3") {
            session.data.serviceType = "support"
            await continueWithService()
          } else {
            await send("Please reply with 1, 2, or 3.")
          }
          break

        // ── NAME (new customers only) & SERVICE SELECTION ──────────────────
        case "1":
          session.data.name = rawMsg.substring(0, 100)
          await saveCustomer(from, { name: session.data.name })
          if (!session.data.serviceType) {
            await send(SERVICE_MENU)
            session.step = "1.5"
          } else {
            await beginService()
          }
          break

        case "1.5":
          if      (msg === "1") session.data.serviceType = "instant"
          else if (msg === "2") session.data.serviceType = "scheduled"
          else if (msg === "3") session.data.serviceType = "upgrade"
          else if (msg === "4") session.data.serviceType = "wasteBags"
          else if (msg === "5") session.data.serviceType = "support"
          else if (msg === "6") { await sendAbout(); break }
          else { await send("Reply with a number from 1 to 6."); break }
          await continueWithService()
          break

        // ── WEEKLY PICKUP PLAN SELECTION (retired) ─────────────────────────
        // No longer offered; kept so conversations already at this step finish.
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

        // ── INSTANT & SCHEDULED PICKUP FLOW ────────────────────────────────
        case "pickup_address":
          session.data.address = rawMsg.substring(0, 300)
          await askBagsOrDate()
          break

        // Waste type is no longer asked; kept for conversations already at this step.
        case "pickup_waste":
          session.data.wasteType = rawMsg.substring(0, 100)
          await askBagsOrDate()
          break

        case "pickup_bags": {
          const bags = Number(msg)
          if (!/^\d+$/.test(msg) || bags < 1) {
            await send("Please reply with the number of bags, e.g. 3.")
            break
          }
          if (bags > MAX_BAGS_PER_PICKUP) {
            await send(`For more than ${MAX_BAGS_PER_PICKUP} bags, please choose a Monthly Subscription or type cancel and speak to support.`)
            break
          }
          const perBag = PICKUP_PRICE_PER_BAG[session.data.serviceType]
          session.data.bagCount = bags
          session.data.pricePerBag = perBag
          session.data.totalAmount = bags * perBag
          await send(`\u{1F6CD} ${bagsText(bags)} \u00D7 ${naira(perBag)} = *${naira(session.data.totalAmount)}*`)
          await askPickupDate()
          session.step = "pickup_date"
          break
        }

        case "pickup_date": {
          const date = await readFutureDate()
          if (!date) break
          session.data.pickupDate = date
          if (session.data.serviceType === "scheduled") {
            await send("Preferred pickup time?\n\n1 - Morning (8am-12pm)\n2 - Afternoon (12pm-4pm)\n3 - Evening (4pm-7pm)\n\nReply 1, 2, or 3.")
            session.step = "pickup_time"
            break
          }
          await sendPickupPayment()
          break
        }

        case "pickup_time":
          if (!PICKUP_TIME_WINDOWS[msg]) { await send("Please reply 1, 2, or 3."); break }
          session.data.timeWindow = PICKUP_TIME_WINDOWS[msg]
          await sendPickupPayment()
          break

        case "pickup_payment":
          if (await saveReceiptBooking()) session.step = "done"
          break

        // ── MONTHLY SUBSCRIPTION FLOW ──────────────────────────────────────
        case "upgrade_choose":
          await send(SUBSCRIPTION_CATEGORY_MENU)
          session.step = "plan_category"
          break

        case "plan_category":
          if      (msg === "1") session.data.planCategory = "business"
          else if (msg === "2") session.data.planCategory = "household"
          else { await send("Please reply 1 for Business or 2 for Household."); break }
          await ensureProfile()
          if (session.data.planCategory === "business" && !session.data.businessName) {
            await send("What is the name of your business?")
            session.step = "business_name"
            break
          }
          if (session.data.planCategory === "household" && !session.data.name) {
            await send("What is your full name?")
            session.step = "household_name"
            break
          }
          await showMonthlyPlans()
          break

        case "business_name":
          session.data.businessName = rawMsg.substring(0, 120)
          await saveCustomer(from, { businessName: session.data.businessName })
          await showMonthlyPlans()
          break

        case "household_name":
          session.data.name = rawMsg.substring(0, 100)
          await saveCustomer(from, { name: session.data.name })
          await showMonthlyPlans()
          break

        case "upgrade_select":
          if (!["1", "2", "3"].includes(msg)) { await send("Please reply 1, 2, or 3."); break }
          session.data.upgradePlan = `${session.data.planCategory || "business"}_${msg}`
          session.data.serviceType = `upgrade_${session.data.upgradePlan}`
          await send("Your pickup address for this plan?")
          session.step = "upgrade_address"
          break

        case "upgrade_address":
          session.data.address = rawMsg.substring(0, 300)
          await send(`When should your plan start?\n\n${DATE_HINT}`)
          session.step = "upgrade_date"
          break

        case "upgrade_date": {
          const date = await readFutureDate()
          if (!date) break
          session.data.startDate = date
          await startCheckout("upgrade_payment")
          break
        }

        case "upgrade_payment":
          if (await saveReceiptBooking()) session.step = "done"
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
            const qty = Number(msg)
            if (!/^\d+$/.test(msg) || qty < 1 || qty > 100) {
              await send("Please reply with the number of packs (1 to 100), e.g. 2.")
              break
            }
            session.data.bagQuantity = qty
            session.data.bagTotal = SERVICE_PRICES[`wasteBags_${session.data.bagSize}`] * qty
            await send("Delivery address?")
            session.step = "bags_address"
          }
          break

        case "bags_address":
          session.data.address = rawMsg.substring(0, 300)
          await startCheckout("bags_payment")
          break

        case "bags_payment":
          if (await saveReceiptBooking()) session.step = "done"
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
            if (msg === "4") {
              const [pickup] = await findActiveBookings(from, ["instantPickups", "pickupRequests"])
              if (!pickup) {
                await send("You don't have an upcoming pickup to change. Send any message to see the menu and book one.")
                session.step = "done"
                break
              }
              session.data.changePickup = { collection: pickup.collection, id: pickup.id, oldDate: pickup.data.pickupDate ?? null }
              await send(
                `Your pickup: *${bookingLabel(pickup)}*` +
                `${pickup.data.pickupDate ? ` on ${displayDate(pickup.data.pickupDate)}` : ""}\n\n` +
                `What new date would you like? ${DATE_HINT}`
              )
              session.step = "change_date"
              break
            }
            await send("Please describe your issue in detail.")
            session.step = "support_describe"
          }
          break

        case "change_date": {
          const date = await readFutureDate()
          if (!date) break
          const { collection, id, oldDate } = session.data.changePickup
          const ref = db.collection(collection).doc(id)
          const snap = await ref.get()
          if (!snap.exists || snap.data().customerPhone !== from || !ACTIVE_STATUSES[collection].includes(snap.data().status)) {
            await send("That pickup can no longer be changed. Please choose Speak to Support and describe what you need.")
            session.step = "done"
            break
          }
          const now = new Date().toISOString()
          await ref.update({ pickupDate: date, previousPickupDate: oldDate, dateChangedAt: now, needsReschedule: false, updatedAt: now })
          // Logged as a ticket so the team sees the change.
          await db.collection("supportTickets").add({
            ticketId: `TKT-${Date.now().toString().slice(-6)}`,
            customerName: session.data.name || session.data.businessName || "",
            customerPhone: from,
            category: "Change Pickup Date",
            message: `Pickup date changed by the customer from ${oldDate ? displayDate(oldDate) : "(none)"} to ${displayDate(date)}.`,
            contactTime: "anytime",
            relatedPickupId: id,
            relatedCollection: collection,
            status: "open",
            createdAt: now,
            updatedAt: now,
          })
          await send(`\u2705 *Pickup date changed*\n\nYour pickup is now on ${displayDate(date)}. We'll message you when a collector is assigned.`)
          session.step = "done"
          break
        }

        case "support_describe":
          session.data.supportMessage = rawMsg.substring(0, 1000)
          await send("What is your preferred contact time? e.g. mornings, afternoons, or type anytime.")
          session.step = "support_contact_time"
          break

        case "support_contact_time":
          session.data.contactTime = rawMsg.substring(0, 100)
          {
            const ticketId = `TKT-${Date.now().toString().slice(-6)}`
            await db.collection("supportTickets").add({
              ticketId,
              customerName: session.data.name || session.data.businessName || "",
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
          session = { step: "0", data: {} }
          await sendServiceMenu()
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
      try { await sendWhatsAppMessage(from, "Sorry, something went wrong on our side. Please send your last message again.") } catch (_) {}
    }
  }

  // ================= ADMIN ACCOUNTS =================
  // Dashboard logins use Firebase Auth. Usernames map to a synthetic email
  // (never emailed). Roles live in admins/{uid}: one "main" admin, created
  // once via /setup, who manages any number of "sub" admins.
  // Sign-in itself goes through Firebase Auth, which already blocks repeated
  // wrong passwords ("too many attempts"). This limits the account-setup and
  // sub-admin endpoints: 30 requests per 15 minutes per IP address.
  const attempts = new Map()
  function rateLimit(req, res, next) {
    const ip = (req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim()
    const now = Date.now()
    const recent = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000)
    if (recent.length >= 30) {
      return res.status(429).json({ error: "Too many attempts. Please wait a few minutes and try again." })
    }
    recent.push(now)
    attempts.set(ip, recent)
    next()
  }
  setInterval(() => {
    const cutoff = Date.now() - 15 * 60 * 1000
    for (const [ip, times] of attempts) if (times.every((t) => t < cutoff)) attempts.delete(ip)
  }, 15 * 60 * 1000).unref()
  app.use(["/api/admin-auth/setup", "/api/sub-admins"], rateLimit)

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
      // Include the Firestore error code (e.g. "16 UNAUTHENTICATED") so the
      // dashboard can show why; it contains no credentials.
      res.status(500).json({
        error: "Could not check admin setup.",
        detail: String(err?.code ?? "") + (err?.details ? ` ${err.details}` : ""),
      })
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

  // ================= PAYSTACK WEBHOOK & RETURN PAGE =================
  // Set https://<your-domain>/paystack/webhook as the webhook URL in the
  // Paystack dashboard (Settings > API Keys & Webhooks).
  app.post("/paystack/webhook", async (req, res) => {
    if (!paystackEnabled()) return res.sendStatus(404)
    const signature = String(req.headers["x-paystack-signature"] || "")
    const expected = crypto.createHmac("sha512", PAYSTACK_SECRET_KEY).update(req.rawBody || "").digest("hex")
    const valid = signature.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    if (!valid) {
      console.warn("Paystack webhook with invalid signature ignored")
      return res.sendStatus(401)
    }
    res.sendStatus(200)

    const { event, data } = req.body || {}
    if (event !== "charge.success" || data?.status !== "success" || data?.currency !== "NGN") return
    try {
      const outcome = await finalizePaystackPayment(data.reference, data.amount, data.channel, data.metadata?.customerPhone)
      console.log(`Paystack ${data.reference}: ${outcome}`)
    } catch (err) {
      console.error("Paystack webhook processing failed:", err)
    }
  })

  // Customers land here after paying. Confirms with Paystack directly in
  // case the webhook is delayed, then tells them to return to WhatsApp.
  app.get("/paystack/callback", async (req, res) => {
    const reference = String(req.query.reference || req.query.trxref || "")
    let paid = false
    if (paystackEnabled() && reference) {
      try {
        const tx = await verifyPaystackTransaction(reference)
        if (tx?.status === "success" && tx.currency === "NGN") {
          const outcome = await finalizePaystackPayment(reference, tx.amount, tx.channel, tx.metadata?.customerPhone)
          paid = outcome === "created" || outcome === "already_paid"
        }
      } catch (err) {
        console.error("Paystack verify failed:", err.response?.data || err.message)
      }
    }
    const icon = paid ? "&#10003;" : "!"
    const title = paid ? "Payment received" : "Payment not confirmed yet"
    const body = paid
      ? "Thank you! Your booking is confirmed and the details are on WhatsApp. You can close this page."
      : "If you completed the payment, you'll get a WhatsApp confirmation shortly. Otherwise go back to WhatsApp and type <b>hi</b> to try again."
    res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>WasteCore - ${title}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#eef6ee;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#17301d;padding:16px;box-sizing:border-box}
  .card{background:#fff;max-width:380px;width:100%;border-radius:18px;padding:32px 24px;text-align:center;
    box-shadow:0 10px 30px rgba(23,48,29,.10)}
  .brand{font-weight:700;color:#2e8b3a;letter-spacing:.3px;margin-bottom:20px}
  .icon{width:64px;height:64px;border-radius:50%;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;
    font-size:32px;font-weight:700;color:#fff;background:${paid ? "#2e8b3a" : "#e0a100"}}
  h1{font-size:22px;margin:0 0 8px}
  p{margin:0 0 24px;line-height:1.5;color:#41584a}
  a.btn{display:block;background:#25d366;color:#fff;text-decoration:none;font-weight:600;padding:14px;border-radius:12px}
</style></head>
<body><main class="card">
  <div class="brand">WasteCore</div>
  <div class="icon">${icon}</div>
  <h1>${title}</h1>
  <p>${body}</p>
  <a class="btn" href="https://wa.me/${businessNumber()}">Back to WhatsApp</a>
</main></body></html>`)
  })

  // Pictures and videos for the "About WasteCore" option; WhatsApp fetches them by URL.
  app.use("/about", express.static(ABOUT_DIR, { maxAge: "1h" }))

  app.get("/health", (req, res) => {
    res.json({ status: "OK", timestamp: new Date().toISOString() })
  })
  app.use((req, res) => handle(req, res))

  const port = process.env.PORT || 3000
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`)
    setupStatusListeners()
    loadBusinessNumber()
    cleanUpOldRecords()
    setInterval(cleanUpOldRecords, 6 * 60 * 60 * 1000).unref()
  })
})