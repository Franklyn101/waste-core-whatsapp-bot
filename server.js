const next = require("next")
require("dotenv").config()
const express = require("express")
const bodyParser = require("body-parser")
const cors = require("cors")
const admin = require("firebase-admin")
const { v2: cloudinary } = require("cloudinary")
const axios = require("axios")
const crypto = require("crypto")
const webpush = require("web-push")
const PDFDocument = require("pdfkit")

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

// Menu options. Each id is the number customers can also type, so tapping
// a WhatsApp list/button and replying "2" lead to the same place.
const SERVICE_OPTIONS = [
  { id: "1", title: "Instant Pickup", description: "We come as soon as possible" },
  { id: "2", title: "Schedule a Pickup", description: "You choose the date and time" },
  { id: "3", title: "Monthly Subscription", description: "Regular weekly pickups" },
  { id: "4", title: "Order Waste Bags", description: "Packs of 10, delivered to you" },
  { id: "5", title: "Speak to Support", description: "Talk to our team" },
  { id: "6", title: "About WasteCore", description: "Our services, photos and video" },
  { id: "7", title: "My Bookings", description: "Status, change date, cancel, renew" },
]
const numberedOptions = (options) => options.map((o) => `${o.id} - ${o.title}`).join("\n")
const SERVICE_MENU = `Choose service:\n${numberedOptions(SERVICE_OPTIONS)}`

const BAG_SIZE_OPTIONS = [
  { id: "1", title: "Small", description: "NGN 500 \u00B7 pack of 10" },
  { id: "2", title: "Medium", description: "NGN 900 \u00B7 pack of 10" },
  { id: "3", title: "Large", description: "NGN 1,500 \u00B7 pack of 10" },
]
const SUPPORT_OPTIONS = [
  { id: "1", title: "Missed Pickup" },
  { id: "2", title: "Billing Issue" },
  { id: "3", title: "Driver Complaint" },
  { id: "4", title: "Change Pickup Date" },
  { id: "5", title: "Other" },
]
const TIME_WINDOW_OPTIONS = [
  { id: "1", title: "Morning 8am-12pm" },
  { id: "2", title: "Afternoon 12pm-4pm" },
  { id: "3", title: "Evening 4pm-7pm" },
]

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

// Template values can't contain line breaks, tabs or long runs of spaces.
const templateParam = (text) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 1000) || "-"

// Sends an approved template straight through Meta's Cloud API (the same
// token as the Pay button), so it works even if Flaxxa blocks template
// sending. Templates are created in WhatsApp Manager > Message templates.
// Tries "English (US)" then "English", whichever the template was made in.
async function sendMetaTemplate(to, templateName, params, { urlButtonParam } = {}) {
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
            components: [
              { type: "body", parameters: params.map((text) => ({ type: "text", text: templateParam(text) })) },
              // Fills the end of a "Visit website" button's dynamic URL.
              ...(urlButtonParam ? [{ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: urlButtonParam }] }] : []),
            ],
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
// Options for templates with a "Visit website" button: urlButtonParam fills
// its URL, and fallbackButton ({ text, url }) is offered in the plain message.
async function notifyCustomer(phone, templateName, params, fallbackText, { urlButtonParam, fallbackButton } = {}) {
  if (await sendMetaTemplate(phone, templateName, params, { urlButtonParam })) return "template"
  const data = await sendWhatsAppTemplate(phone, templateName, "en_US", [
    { type: "body", parameters: params.map((text) => ({ type: "text", text: templateParam(text) })) },
    ...(urlButtonParam ? [{ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: urlButtonParam }] }] : []),
  ])
  if (templateSent(data)) return "template"
  console.warn(`Template "${templateName}" not sent to ${phone}; sending a plain message instead.`)
  if (fallbackButton && await sendWhatsAppUrlButton(phone, { body: fallbackText, buttonText: fallbackButton.text, url: fallbackButton.url })) {
    return "text"
  }
  const text = fallbackButton ? `${fallbackText}\n\n${fallbackButton.url}` : fallbackText
  return (await sendWhatsAppMessage(phone, text)) ? "text" : "failed"
}

// Bookings paid by Paystack (or a bank transfer an admin has checked)
// count as paid; receipt photos nobody has checked yet do not.
const paymentVerified = (data) => data.paymentMethod === "paystack" || data.paymentStatus === "paid"

function setupStatusListeners() {
  const handleChanges = (collectionName) => {
    // The first snapshot lists every existing document; only documents
    // added after it are new activity for the admins.
    let initialLoad = true
    db.collection(collectionName).onSnapshot(
      (snapshot) => {
        const isInitial = initialLoad
        initialLoad = false
        snapshot.docChanges().forEach(async (change) => {
         try {
          const data = change.doc.data()

          if (change.type === "added" && !isInitial) {
            const alert = newActivityAlert(collectionName, change.doc.id, data)
            if (alert) await notifyAdmins(alert)
          }

          // A collector was (re)assigned on the dashboard: message them.
          if (change.type !== "removed" && COLLECTOR_COLLECTIONS.includes(collectionName)) {
            await notifyCollectorIfAssigned(collectionName, change.doc)
          }

          if (change.type !== "removed" && collectionName === "upgradeRequests") {
            await setPaidUntilOnceVerified(change.doc)
            await sendRenewalReminderIfRequested("upgradeRequests", change.doc)
            await issueSubscriptionReceipts("upgradeRequests", change.doc, isInitial)
          }
          if (change.type !== "removed" && RECEIPT_BOOKING_COLLECTIONS.includes(collectionName)) {
            await issueBookingReceipt(collectionName, change.doc)
          }

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
                toWhatsAppId(data.customerPhone) || data.customerPhone,
                TEMPLATE_COMPLETED,
                [date || "today"],
                `\u2705 *Pickup completed*\n\nYour pickup${date ? ` on ${date}` : ""} has been completed. Thank you for choosing WasteCore! \u267B\uFE0F`
              )
              if (COLLECTOR_COLLECTIONS.includes(collectionName)) await askForRating(collectionName, change.doc.id, data)
              // Subscription visits are covered by the monthly plan: no invoice.
              if (collectionName === "subscriptionVisits") return
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
  handleChanges("subscriptionVisits")
  setupSubscriberWelcome()
  setupCollectorSummaries()
}

// ================= SUBSCRIPTION PAYMENTS & RENEWALS =================
// Each subscription (an admin-registered subscriber, or a monthly plan
// booked on WhatsApp in upgradeRequests) carries:
//   lastPaymentDate, lastPaymentAmount, lastPaymentMethod, payments[] and
//   paidUntil: the date the next monthly payment is due.
// Bot payments set them automatically; admins record cash/transfer/POS
// payments on the dashboard. "Send renewal reminder" on the dashboard sets
// renewalReminderRequestedAt; the bot then sends the customer a "Renew now"
// link (/renew/<token>) that opens a Paystack payment for their plan. When
// it's paid, paidUntil moves on by a month.
//
// Customers may not have messaged the bot recently, so the reminder needs
// an approved template (WAPI_TEMPLATE_RENEWAL), category Utility:
//   name: "subscription_renewal"
//   body: "Hello {{1}}, your WasteCore {{2}} subscription {{3}}. Renew for {{4}}
//          to keep your pickups going. Tap the button below to pay securely."
//   button: Visit website, "Renew now", dynamic URL
//           <PUBLIC_BASE_URL>/renew/{{1}}
const TEMPLATE_RENEWAL = process.env.WAPI_TEMPLATE_RENEWAL || "subscription_renewal"

// "2026-01-31" + 1 month -> "2026-02-28" (the day is kept where it exists).
function addMonthsIso(iso, months) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, lastDay))
  return target.toISOString().slice(0, 10)
}

const laterDate = (a, b) => (!a ? b : !b ? a : a > b ? a : b)

// Plan id from a subscriber ("business_2") or WhatsApp plan request.
const subscriptionPlanId = (data) =>
  data.planId || data.plan || String(data.serviceType || "").replace(/^upgrade_/, "")

// Monthly price, or null for retired weekly plans (not renewed here).
function monthlyPrice(planId) {
  const [category, n] = String(planId).split("_")
  return MONTHLY_PLANS[category]?.prices[n] ?? SERVICE_PRICES[`upgrade_${planId}`] ?? null
}

// WhatsApp plan requests paid by bank transfer get their paid-until date
// once an admin verifies the receipt (Paystack ones get it when paid).
async function setPaidUntilOnceVerified(docSnap) {
  const data = docSnap.data()
  if (data.paidUntil || !paymentVerified(data)) return
  const paidOn = String(data.paidAt || data.receiptVerifiedAt || data.createdAt || lagosToday()).slice(0, 10)
  const amount = data.totalAmount ?? monthlyPrice(subscriptionPlanId(data))
  await docSnap.ref.update({
    lastPaymentDate: paidOn,
    lastPaymentAmount: amount ?? null,
    lastPaymentMethod: data.paymentMethod || "bank_transfer",
    paidUntil: addMonthsIso(laterDate(data.startDate, paidOn), 1),
    payments: [...(data.payments || []), { date: paidOn, amount: amount ?? null, method: data.paymentMethod || "bank_transfer", months: 1 }],
  })
}

function renewalWhen(paidUntil) {
  if (!paidUntil) return "is due for renewal"
  return paidUntil < lagosToday() ? `expired on ${displayDate(paidUntil)}` : `expires on ${displayDate(paidUntil)}`
}

// Sends one reminder per click on the dashboard (renewalReminderRequestedAt),
// recording the outcome in renewalReminder for the dashboard to show.
async function sendRenewalReminderIfRequested(collectionName, docSnap) {
  const data = docSnap.data()
  const requestedAt = data.renewalReminderRequestedAt
  if (!requestedAt || data.renewalReminder?.requestedAt === requestedAt) return
  try {
    await docSnap.ref.update(
      { renewalReminder: { status: "sending", requestedAt, at: new Date().toISOString() } },
      { lastUpdateTime: docSnap.updateTime }
    )
  } catch {
    return
  }
  let status
  try {
    status = await sendRenewalReminder(collectionName, docSnap.id, data)
  } catch (err) {
    console.error(`Renewal reminder failed for ${collectionName}/${docSnap.id}:`, err)
    status = "failed"
  }
  await docSnap.ref.update({ renewalReminder: { status, requestedAt, at: new Date().toISOString() } })
    .catch((err) => console.error("Could not record renewal reminder status:", err))
}

// Short random token in the link; the subscription is looked up from it.
async function createRenewalLink(collectionName, id, phone) {
  const token = crypto.randomBytes(9).toString("base64url")
  await db.collection("renewals").doc(token).set({ collection: collectionName, id, customerPhone: phone, createdAt: new Date().toISOString() })
  return { token, url: `${PUBLIC_BASE_URL}/renew/${token}` }
}

async function sendRenewalReminder(collectionName, id, data) {
  const phone = toWhatsAppId(data.customerPhone)
  if (!phone) return "invalid_phone"
  const planId = subscriptionPlanId(data)
  const price = monthlyPrice(planId)
  if (!price) return "no_price"
  if (!PUBLIC_BASE_URL) {
    console.error("PUBLIC_BASE_URL is not set, so renewal links can't be made.")
    return "failed"
  }
  const { token, url } = await createRenewalLink(collectionName, id, phone)
  const name = String(data.customerName || "").trim() || "there"
  const plan = subscriptionPlanText(planId).label
  const when = renewalWhen(data.paidUntil)
  return notifyCustomer(
    phone,
    TEMPLATE_RENEWAL,
    [name, plan, when, `${naira(price)}/month`],
    [
      `\u{1F514} *Time to renew your WasteCore subscription*`,
      "",
      `Hello ${name}, your *${plan}* subscription ${when}.`,
      "",
      `Renew for *${naira(price)}/month* to keep your pickups going. Tap *Renew now* to pay securely by card, bank transfer or USSD.`,
    ].join("\n"),
    { urlButtonParam: token, fallbackButton: { text: "Renew now", url } }
  )
}

// Creates the Paystack payment for a renewal link. Returns the checkout URL,
// or null if Paystack isn't set up or couldn't be reached.
async function createRenewalPayment(renewal, target) {
  if (!paystackEnabled()) return null
  const planId = subscriptionPlanId(target)
  const amount = monthlyPrice(planId)
  if (!amount) return null
  const reference = newPaymentReference()
  await db.collection("pendingPayments").doc(reference).set({
    kind: "renewal",
    target: { collection: renewal.collection, id: renewal.id },
    amount,
    months: 1,
    planId,
    customerPhone: renewal.customerPhone,
    status: "pending",
    createdAt: new Date().toISOString(),
  })
  const url = await initializePaystack(reference, amount, renewal.customerPhone, `${subscriptionPlanText(planId).label} renewal (1 month)`)
  if (!url) await db.collection("pendingPayments").doc(reference).update({ status: "init_failed" }).catch(() => {})
  return url
}

// ================= COLLECTORS =================
// Pickups are assigned per job on the dashboard (instant, scheduled, and
// each day's subscription visit), so a collector never owns a customer.
// The bot messages the collector when a job is assigned to them, sends a
// morning summary of the day's jobs, and answers "JOBS" with their list.
//
// Collectors have often not messaged the bot, so these need approved
// templates (category Utility) in WhatsApp Manager:
//   "collector_new_pickup":
//     "Hello {{1}}, you have a new WasteCore pickup on {{2}}. Customer: {{3}}.
//      Address: {{4}}. Directions: {{5}}. Reply JOBS to see all your pickups."
//   "collector_daily_summary":
//     "Good morning {{1}}! You have {{2}} WasteCore pickups today: {{3}}.
//      Reply JOBS to see them with directions."
const TEMPLATE_COLLECTOR_PICKUP = process.env.WAPI_TEMPLATE_COLLECTOR_PICKUP || "collector_new_pickup"
const TEMPLATE_COLLECTOR_SUMMARY = process.env.WAPI_TEMPLATE_COLLECTOR_SUMMARY || "collector_daily_summary"
const COLLECTOR_SUMMARY_HOUR = Number(process.env.COLLECTOR_SUMMARY_HOUR || 7) // Nigerian time
const COLLECTOR_COLLECTIONS = ["instantPickups", "pickupRequests", "subscriptionVisits"]
const OPEN_JOB_STATUSES = ["pending", "assigned", "confirmed"]
const SERVICE_AREA = process.env.SERVICE_AREA || "Yenagoa"

// Directions link; the town is added when the address doesn't name it.
// Directions: the customer's location pin when they shared one, otherwise a
// search for the typed address.
function mapsLink(address, location) {
  if (Number.isFinite(location?.lat) && Number.isFinite(location?.lng)) {
    return `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`
  }
  const a = String(address || "").trim()
  if (!a) return ""
  const query = a.toLowerCase().includes(SERVICE_AREA.toLowerCase()) ? a : `${a}, ${SERVICE_AREA}`
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

// "2026-11-07" -> "Sat 7 Nov"
function shortDay(iso) {
  const d = new Date(`${iso}T00:00:00`)
  if (isNaN(d.getTime())) return iso || ""
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
}

function jobWhat(job) {
  if (job.bagCount) return bagsText(job.bagCount)
  return job.serviceLabel || PICKUP_SERVICE_LABELS[job.serviceType] || (job.serviceType === "subscription" ? "Subscription pickup" : "Pickup")
}

function jobCustomer(job) {
  const phone = toWhatsAppId(job.customerPhone)
  return [job.customerName || "Customer", phone ? normalizePhone(phone) : null].filter(Boolean).join(" \u00B7 ")
}

async function loadCollector(collectorId) {
  if (!collectorId) return null
  const snap = await db.collection("collectors").doc(collectorId).get()
  return snap.exists ? { ...snap.data(), id: collectorId } : null
}

// Collector whose WhatsApp number sent a message, if any (cached briefly).
let collectorCache = { at: 0, list: [] }
async function findCollectorByPhone(from) {
  if (Date.now() - collectorCache.at > 5 * 60 * 1000) {
    const snap = await db.collection("collectors").get()
    collectorCache = { at: Date.now(), list: snap.docs.map((d) => ({ id: d.id, ...d.data() })) }
  }
  return collectorCache.list.find((c) => c.active !== false && toWhatsAppId(c.phone) === from) || null
}

// The dashboard sets collectorAssignedAt each time it assigns a collector;
// collectorNotifiedAt records which assignment was messaged, so each one is
// sent once (also after a restart) and older jobs are never re-sent.
async function notifyCollectorIfAssigned(collectionName, docSnap) {
  const job = docSnap.data()
  if (!job.collectorId || !job.collectorAssignedAt || job.collectorAssignedAt === job.collectorNotifiedAt) return
  if (!OPEN_JOB_STATUSES.includes(job.status)) return
  try {
    await docSnap.ref.update({ collectorNotifiedAt: job.collectorAssignedAt }, { lastUpdateTime: docSnap.updateTime })
  } catch {
    return // changed meanwhile; the next snapshot handles it
  }
  const collector = await loadCollector(job.collectorId)
  const phone = toWhatsAppId(collector?.phone)
  let status = "failed"
  if (phone) {
    const when = `${shortDay(job.pickupDate)}${job.timeWindow ? `, ${job.timeWindow}` : ""}`
    const link = mapsLink(job.address, job.location)
    status = await notifyCustomer(
      phone,
      TEMPLATE_COLLECTOR_PICKUP,
      [collector.name || "there", when, `${jobCustomer(job)} (${jobWhat(job)})`, job.address || "-", link || "-"],
      [
        `\u{1F69B} *New pickup for you*`,
        "",
        `\u{1F4C5} ${when}`,
        `\u{1F464} ${jobCustomer(job)}`,
        `\u{1F4CD} ${job.address || "No address"}`,
        ...(link ? [`${job.location ? "\u{1F4CC} Pin" : "\u{1F5FA} Map"}: ${link}`] : []),
        `\u{1F6CD} ${jobWhat(job)}`,
        "",
        "Reply *JOBS* to see all your pickups.",
      ].join("\n")
    )
  }
  await docSnap.ref.update({ collectorMessage: { status, at: new Date().toISOString() } })
    .catch((err) => console.error(`Could not record collector message on ${collectionName}/${docSnap.id}:`, err))
}

// Open jobs on the given dates, grouped by collector id.
async function jobsByCollector(dates) {
  const queries = COLLECTOR_COLLECTIONS.flatMap((col) => dates.map((date) => ({ col, date })))
  const snaps = await Promise.all(queries.map(({ col, date }) => db.collection(col).where("pickupDate", "==", date).get()))
  const byCollector = new Map()
  snaps.forEach((snap, i) => {
    for (const d of snap.docs) {
      // _ref lets a collector's "DONE 2" find the job's document.
      const job = { ...d.data(), _ref: { collection: queries[i].col, id: d.id } }
      if (!job.collectorId || !OPEN_JOB_STATUSES.includes(job.status)) continue
      if (!byCollector.has(job.collectorId)) byCollector.set(job.collectorId, [])
      byCollector.get(job.collectorId).push(job)
    }
  })
  const order = { "Morning (8am-12pm)": 1, "Afternoon (12pm-4pm)": 2, "Evening (4pm-7pm)": 3 }
  for (const list of byCollector.values()) {
    list.sort((a, b) =>
      a.pickupDate.localeCompare(b.pickupDate) ||
      (order[a.timeWindow] ?? 0) - (order[b.timeWindow] ?? 0) ||
      String(a.customerName || "").localeCompare(String(b.customerName || "")))
  }
  return byCollector
}

// Reply to "JOBS": today's and the next two days' open jobs, numbered so
// the collector can reply "DONE 2" / "FAILED 2 reason". The numbering is
// saved in collectorJobLists/{collectorId} so those replies find the job.
async function collectorJobsMessage(collector) {
  const today = lagosToday()
  const dates = [today, addDays(today, 1), addDays(today, 2)]
  const jobs = (await jobsByCollector(dates)).get(collector.id) || []
  await db.collection("collectorJobLists").doc(collector.id).set({
    jobs: jobs.map((j) => ({ ...j._ref, customerName: j.customerName || "" })),
    at: new Date().toISOString(),
  }, { merge: true })
  if (!jobs.length) return `Hello ${collector.name || ""}! You have no pickups assigned for today or the next 2 days.`.replace("Hello !", "Hello!")
  const lines = [`\u{1F4CB} *Your pickups, ${collector.name || ""}*`.replace(", *", "*")]
  let number = 0
  for (const date of dates) {
    const day = jobs.filter((j) => j.pickupDate === date)
    if (!day.length) continue
    const label = date === today ? "Today" : date === dates[1] ? "Tomorrow" : ""
    lines.push("", `*${label ? `${label}, ` : ""}${shortDay(date)}*`)
    for (const j of day) {
      number++
      const link = mapsLink(j.address, j.location)
      const report = j.collectorReport?.status === "done" ? "\u2705 Reported done, waiting for admin"
        : j.collectorReport?.status === "failed" ? "\u274C Reported not picked up" : null
      lines.push(
        `*${number}.* ${jobCustomer(j)}`,
        `   \u{1F4CD} ${j.address || "No address"}`,
        ...(link ? [`   ${j.location ? "\u{1F4CC} Pin" : "\u{1F5FA} Map"}: ${link}`] : []),
        `   \u{1F6CD} ${jobWhat(j)}${j.timeWindow ? ` \u00B7 ${j.timeWindow}` : ""}`,
        ...(report ? [`   ${report}`] : [])
      )
    }
  }
  lines.push(
    "",
    "After a pickup, reply *DONE* and the job number, e.g. *DONE 1*.",
    "If you couldn't pick up, reply *FAILED*, the number and why, e.g. *FAILED 1 gate locked*."
  )
  return lines.join("\n")
}

// Finds job number `n` from the collector's last list (or a fresh one).
// Returns { ref, data } or a message explaining why it can't be used.
async function collectorJob(collector, n) {
  const listRef = db.collection("collectorJobLists").doc(collector.id)
  let list = (await listRef.get()).data()
  const fresh = list?.at && Date.now() - Date.parse(list.at) < 36 * 60 * 60 * 1000
  if (!fresh) {
    await collectorJobsMessage(collector)
    list = (await listRef.get()).data()
  }
  const entry = list?.jobs?.[n - 1]
  if (!entry) return { error: `There's no job ${n} on your list. Reply *JOBS* to see your numbered pickups.` }
  const ref = db.collection(entry.collection).doc(entry.id)
  const snap = await ref.get()
  const data = snap.exists ? snap.data() : null
  if (!data || data.collectorId !== collector.id) return { error: `Job ${n} is no longer assigned to you. Reply *JOBS* for your current list.` }
  if (!OPEN_JOB_STATUSES.includes(data.status)) return { error: `Job ${n} (${data.customerName || "customer"}) is already ${data.status}.` }
  return { ref, data, entry }
}

// Morning summary: once a day after COLLECTOR_SUMMARY_HOUR (Nigerian time),
// each active collector with jobs today gets one message listing them.
async function sendCollectorSummaries() {
  const now = new Date()
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "numeric", hourCycle: "h23" }).format(now))
  if (hour < COLLECTOR_SUMMARY_HOUR || hour >= 12) return
  const today = lagosToday()
  const markerRef = db.collection("config").doc("collectorSummary")
  const claimed = await db.runTransaction(async (t) => {
    const snap = await t.get(markerRef)
    if (snap.exists && snap.data().lastDate === today) return false
    t.set(markerRef, { lastDate: today, sentAt: now.toISOString() }, { merge: true })
    return true
  })
  if (!claimed) return

  const byCollector = await jobsByCollector([today])
  let sent = 0
  for (const [collectorId, jobs] of byCollector) {
    const collector = await loadCollector(collectorId)
    const phone = toWhatsAppId(collector?.phone)
    if (!phone || collector.active === false) continue
    const short = jobs.map((j, i) => `${i + 1}) ${j.customerName || "Customer"}, ${j.address || "no address"}`).join("; ")
    await notifyCustomer(
      phone,
      TEMPLATE_COLLECTOR_SUMMARY,
      [collector.name || "there", jobs.length, short.length > 700 ? `${short.slice(0, 690)}...` : short],
      `\u2600\uFE0F *Good morning ${collector.name || ""}!*`.replace(" !*", "!*") +
        `\n\nYou have ${jobs.length} pickup${jobs.length > 1 ? "s" : ""} today.\n\n` +
        (await collectorJobsMessage(collector))
    )
    sent++
  }
  console.log(`Collector morning summary sent to ${sent} collector(s)`)
}

function setupCollectorSummaries() {
  const run = () => {
    sendCollectorSummaries().catch((err) => console.error("Collector summary failed:", err))
    sendAdminDigest().catch((err) => console.error("Admin digest failed:", err))
    sendAutomaticRenewalReminders().catch((err) => console.error("Automatic renewal reminders failed:", err))
    sendPickupReminders().catch((err) => console.error("Pickup reminders failed:", err))
  }
  run()
  setInterval(run, 10 * 60 * 1000).unref()
}

// ================= ADMIN NOTIFICATIONS =================
// Activity worth an admin's attention is saved in `notifications` (the
// dashboard's bell reads it live) and pushed to every device where an
// admin turned on notifications, so they hear about it with the dashboard
// closed. Push uses the Web Push standard (VAPID keys): set VAPID_PUBLIC_KEY
// and VAPID_PRIVATE_KEY, or keys are generated once and kept in
// config/webPush.
let webPushReady = null

function webPushKeys() {
  if (!webPushReady) {
    webPushReady = (async () => {
      let publicKey = process.env.VAPID_PUBLIC_KEY
      let privateKey = process.env.VAPID_PRIVATE_KEY
      if (!publicKey || !privateKey) {
        const ref = db.collection("config").doc("webPush")
        const snap = await ref.get()
        if (snap.exists && snap.data().publicKey) {
          ({ publicKey, privateKey } = snap.data())
        } else {
          const keys = webpush.generateVAPIDKeys()
          try {
            await ref.create({ ...keys, createdAt: new Date().toISOString() })
            ;({ publicKey, privateKey } = keys)
          } catch {
            ({ publicKey, privateKey } = (await ref.get()).data()) // another instance made them first
          }
        }
      }
      const subject = process.env.VAPID_SUBJECT || PUBLIC_BASE_URL || "mailto:admin@wastecore.ng"
      webpush.setVapidDetails(subject, publicKey, privateKey)
      return { publicKey }
    })().catch((err) => {
      console.error("Web push setup failed:", err.message)
      webPushReady = null
      return null
    })
  }
  return webPushReady
}

// Pushes to every device of every active admin (or only `uid`'s devices).
async function sendAdminPush(payload, uid) {
  if (!(await webPushKeys())) return 0
  const [subs, admins] = await Promise.all([
    db.collection("pushSubscriptions").get(),
    db.collection("admins").get(),
  ])
  const active = new Set(admins.docs.filter((d) => d.data().active !== false).map((d) => d.id))
  let sent = 0
  await Promise.all(subs.docs.map(async (d) => {
    const sub = d.data()
    if (!active.has(sub.uid) || (uid && sub.uid !== uid)) return
    try {
      await webpush.sendNotification(sub.subscription, JSON.stringify(payload), { TTL: 24 * 60 * 60, urgency: "high" })
      sent++
    } catch (err) {
      // 404/410: the device unsubscribed or the browser data was cleared.
      if (err.statusCode === 404 || err.statusCode === 410) await d.ref.delete().catch(() => {})
      else console.error("Push to an admin device failed:", err.statusCode || err.message)
    }
  }))
  return sent
}

// Saves one notification (once per `key`) and pushes it to admins.
// `section` is the dashboard page it opens.
async function notifyAdmins({ key, type, title, body, section }) {
  try {
    const ref = key ? db.collection("notifications").doc(String(key).replace(/\//g, "_").slice(0, 300)) : db.collection("notifications").doc()
    try {
      await ref.create({ type, title, body, section, createdAt: new Date().toISOString() })
    } catch (err) {
      if (err.code === 6) return // already notified
      throw err
    }
    await sendAdminPush({ title, body, section, tag: ref.id })
  } catch (err) {
    console.error("Admin notification failed:", err.message)
  }
}

// What a new booking/request/ticket looks like as a notification.
function newActivityAlert(collectionName, id, data) {
  // Bookings made while the server was down are older; don't alert late.
  if (data.createdAt && Date.now() - Date.parse(data.createdAt) > 15 * 60 * 1000) return null
  const name = data.customerName || normalizePhone(data.customerPhone || "") || "A customer"
  const paid = data.paymentMethod === "paystack" ? ` · ${naira(data.totalAmount ?? 0)} paid (Paystack)`
    : data.paymentReceiptUrl ? " · receipt sent, verify payment" : ""
  const key = `new_${collectionName}_${id}`
  const area = data.outsideArea ? " \u26A0\uFE0F outside service area" : ""
  const alert = newActivityAlertFor(collectionName, data, name, paid, key)
  return alert && { ...alert, body: `${alert.body}${area}` }
}

function newActivityAlertFor(collectionName, data, name, paid, key) {
  switch (collectionName) {
    case "instantPickups":
      return { key, type: "booking", section: "instant-pickups", title: "New instant pickup",
        body: `${name} · ${data.bagCount ? bagsText(data.bagCount) : "pickup"}${data.pickupDate ? ` · ${displayDate(data.pickupDate)}` : ""}${paid}` }
    case "pickupRequests":
      return { key, type: "booking", section: "pickup-requests", title: "New scheduled pickup",
        body: `${name}${data.pickupDate ? ` · ${displayDate(data.pickupDate)}` : ""}${data.timeWindow ? `, ${data.timeWindow}` : ""}${paid}` }
    case "upgradeRequests":
      return { key, type: "subscription", section: "upgrade-plans", title: "New monthly subscription",
        body: `${name} · ${data.planLabel || subscriptionPlanText(subscriptionPlanId(data)).label}${paid}` }
    case "wasteBagOrders":
      return { key, type: "order", section: "waste-bag-orders", title: "New waste bag order",
        body: `${name} · ${data.bagSize || ""} bags × ${data.quantity ?? 1}${paid}` }
    case "supportTickets":
      return { key, type: "support", section: "support-tickets", title: `Support: ${data.category || "new ticket"}`,
        body: `${name}${data.message ? ` · ${String(data.message).slice(0, 120)}` : ""}` }
    default:
      return null
  }
}

// Once a day (with the collectors' morning summary): subscriptions that
// have expired or expire within a week.
async function sendAdminDigest() {
  const now = new Date()
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "numeric", hourCycle: "h23" }).format(now))
  if (hour < COLLECTOR_SUMMARY_HOUR || hour >= 12) return
  const today = lagosToday()
  const markerRef = db.collection("config").doc("adminDigest")
  const claimed = await db.runTransaction(async (t) => {
    const snap = await t.get(markerRef)
    if (snap.exists && snap.data().lastDate === today) return false
    t.set(markerRef, { lastDate: today, sentAt: now.toISOString() }, { merge: true })
    return true
  })
  if (!claimed) return
  const [subscribers, requests] = await Promise.all([
    db.collection("subscribers").get(),
    db.collection("upgradeRequests").get(),
  ])
  // WhatsApp plans already managed as subscribers are counted once.
  const linked = new Set(subscribers.docs.map((d) => d.data().linkedRequestId).filter(Boolean))
  const rows = [
    ...subscribers.docs.map((d) => d.data()).filter((r) => r.status === "active"),
    ...requests.docs.filter((d) => !linked.has(d.id)).map((d) => d.data()).filter((r) => r.status !== "cancelled"),
  ]
  const weekAhead = addDays(today, 7)
  const expired = rows.filter((r) => r.paidUntil && r.paidUntil < today).length
  const expiring = rows.filter((r) => r.paidUntil && r.paidUntil >= today && r.paidUntil <= weekAhead).length
  if (!expired && !expiring) return
  await notifyAdmins({
    key: `digest_${today}`,
    type: "renewal",
    section: "subscriptions",
    title: "Subscriptions to renew",
    body: [expired && `${expired} expired`, expiring && `${expiring} expiring this week`].filter(Boolean).join(", ") + ". Send renewal reminders from Subscriptions.",
  })
}

// ================= RECEIPTS =================
// Every confirmed payment gets a numbered PDF receipt (WC-000001...),
// stored in receipts/{token} and served at /receipts/<token>.pdf. The
// customer is sent the PDF on WhatsApp (it arrives if they messaged within
// 24 hours; otherwise a link is sent as text, and admins can open it from
// the dashboard).
const RECEIPT_BOOKING_COLLECTIONS = ["instantPickups", "pickupRequests", "wasteBagOrders"]
const RECEIPT_SERVICE_LABELS = {
  instantPickups: "Instant pickup",
  pickupRequests: "Scheduled pickup",
  wasteBagOrders: "Waste bags",
}
const METHOD_NAMES = { paystack: "Paystack", bank_transfer: "Bank transfer", cash: "Cash", pos: "POS", other: "Other" }

async function nextReceiptNumber() {
  const ref = db.collection("config").doc("receiptCounter")
  const n = await db.runTransaction(async (t) => {
    const snap = await t.get(ref)
    const next = (snap.exists ? Number(snap.data().next) || 1 : 1)
    t.set(ref, { next: next + 1 }, { merge: true })
    return next
  })
  return `WC-${String(n).padStart(6, "0")}`
}

async function issueReceipt({ customerName, customerPhone, description, amount, method, reference, paidOn, source }) {
  const token = crypto.randomBytes(12).toString("base64url")
  const number = await nextReceiptNumber()
  await db.collection("receipts").doc(token).set({
    number, customerName: customerName || "", customerPhone: normalizePhone(customerPhone || ""),
    description, amount, method: method || "other", reference: reference || "", paidOn: paidOn || lagosToday(),
    source, createdAt: new Date().toISOString(),
  })
  const phone = toWhatsAppId(customerPhone)
  if (phone && PUBLIC_BASE_URL) {
    const url = `${PUBLIC_BASE_URL}/receipts/${token}.pdf`
    const caption = `\u{1F9FE} Receipt ${number} \u00B7 ${naira(amount)} \u00B7 ${description}. Thank you for choosing WasteCore!`
    const sent = await sendWhatsAppMedia(phone, { type: "document", url, filename: `WasteCore-receipt-${number}.pdf`, caption })
    if (!sent) await sendWhatsAppMessage(phone, `${caption}\n\nDownload: ${url}`)
  }
  return { token, number }
}

// Paid pickups and bag orders (Paystack, or a bank transfer once verified).
// Only payments from the last 2 days, so a restart never re-sends old ones.
async function issueBookingReceipt(collectionName, docSnap) {
  const data = docSnap.data()
  if (data.receiptNumber || !paymentVerified(data) || data.status === "cancelled") return
  const paidAt = data.paidAt || data.receiptVerifiedAt
  if (!paidAt || Date.now() - Date.parse(paidAt) > 2 * 86400000) return
  const amount = Number(data.totalAmount) || 0
  if (!amount) return
  try {
    await docSnap.ref.update({ receiptNumber: "issuing" }, { lastUpdateTime: docSnap.updateTime })
  } catch {
    return // changed meanwhile; the next snapshot handles it
  }
  const what = data.bagCount ? ` (${bagsText(data.bagCount)})` : data.bagSize ? ` (${data.bagSize} \u00D7 ${data.quantity ?? 1})` : ""
  const { token, number } = await issueReceipt({
    customerName: data.customerName, customerPhone: data.customerPhone,
    description: `${RECEIPT_SERVICE_LABELS[collectionName]}${what}${data.pickupDate ? `, ${displayDate(data.pickupDate)}` : ""}`,
    amount, method: data.paymentMethod, reference: data.paymentReference, paidOn: String(paidAt).slice(0, 10),
    source: { collection: collectionName, id: docSnap.id },
  })
  await docSnap.ref.update({ receiptNumber: number, receiptToken: token })
}

// Subscription payments (first month, renewals, payments recorded on the
// dashboard) are in payments[]; receiptCount says how many have receipts.
// Payments already there when the server starts are not re-sent.
async function issueSubscriptionReceipts(collectionName, docSnap, isInitial) {
  const data = docSnap.data()
  const payments = Array.isArray(data.payments) ? data.payments : []
  if (data.receiptCount === undefined && isInitial) {
    if (payments.length) await docSnap.ref.update({ receiptCount: payments.length }).catch(() => {})
    return
  }
  const done = Number(data.receiptCount) || 0
  if (payments.length <= done) return
  try {
    await docSnap.ref.update({ receiptCount: payments.length }, { lastUpdateTime: docSnap.updateTime })
  } catch {
    return
  }
  const plan = subscriptionPlanText(subscriptionPlanId(data)).label
  const issued = []
  for (let i = done; i < payments.length; i++) {
    const p = payments[i]
    if (!(Number(p.amount) > 0)) continue
    const months = Number(p.months) || 1
    const r = await issueReceipt({
      customerName: data.customerName, customerPhone: data.customerPhone,
      description: `${plan}, ${months} month${months > 1 ? "s" : ""}`,
      amount: Number(p.amount), method: p.method, reference: p.reference, paidOn: p.date,
      source: { collection: collectionName, id: docSnap.id, payment: i },
    })
    issued.push([i, r])
  }
  if (!issued.length) return
  // Note each receipt on its payment, for the dashboard's receipt links.
  const fresh = (await docSnap.ref.get()).data()
  const list = Array.isArray(fresh?.payments) ? [...fresh.payments] : []
  for (const [i, r] of issued) if (list[i]) list[i] = { ...list[i], receiptNumber: r.number, receiptToken: r.token }
  await docSnap.ref.update({ payments: list })
}

function renderReceiptPdf(receipt, res) {
  const doc = new PDFDocument({ size: "A5", margin: 36, info: { Title: `WasteCore receipt ${receipt.number}` } })
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `inline; filename="WasteCore-receipt-${receipt.number}.pdf"`)
  doc.pipe(res)
  const green = "#3a8f1f"
  const ngn = (n) => `NGN ${Number(n).toLocaleString("en-NG")}`
  const left = doc.page.margins.left
  const width = doc.page.width - left - doc.page.margins.right

  doc.fillColor(green).font("Helvetica-Bold").fontSize(22).text("WasteCore", left, 36)
  doc.fillColor("#555").font("Helvetica").fontSize(9).text(`Waste collection \u00B7 ${SERVICE_AREA}`, left, 62)
  doc.fillColor("#111").font("Helvetica-Bold").fontSize(14).text("RECEIPT", left, 40, { width, align: "right" })
  doc.font("Helvetica").fontSize(9).fillColor("#555")
    .text(`No. ${receipt.number}`, left, 58, { width, align: "right" })
    .text(`Date: ${displayDate(receipt.paidOn)}`, left, 70, { width, align: "right" })

  doc.moveTo(left, 92).lineTo(left + width, 92).strokeColor("#ddd").stroke()
  doc.fillColor("#555").fontSize(8).text("BILLED TO", left, 104)
  doc.fillColor("#111").font("Helvetica-Bold").fontSize(11).text(receipt.customerName || "Customer", left, 116)
  doc.font("Helvetica").fontSize(9).fillColor("#333").text(receipt.customerPhone || "", left, 131)

  let y = 160
  doc.rect(left, y, width, 20).fill("#f2f7ef")
  doc.fillColor("#333").font("Helvetica-Bold").fontSize(9)
    .text("Description", left + 8, y + 6)
    .text("Amount", left, y + 6, { width: width - 8, align: "right" })
  y += 28
  doc.font("Helvetica").fontSize(10).fillColor("#111")
    .text(receipt.description, left + 8, y, { width: width - 110 })
    .text(ngn(receipt.amount), left, y, { width: width - 8, align: "right" })
  y = Math.max(doc.y, y + 14) + 10
  doc.moveTo(left, y).lineTo(left + width, y).strokeColor("#ddd").stroke()
  y += 10
  doc.font("Helvetica-Bold").fontSize(12)
    .text("Total paid", left + 8, y)
    .text(ngn(receipt.amount), left, y, { width: width - 8, align: "right" })
  y += 30
  doc.font("Helvetica").fontSize(9).fillColor("#555")
    .text(`Payment method: ${METHOD_NAMES[receipt.method] || receipt.method}`, left + 8, y)
  if (receipt.reference) doc.text(`Reference: ${receipt.reference}`, left + 8, y + 13)

  // "PAID" stamp
  doc.save().rotate(-12, { origin: [left + width - 60, y + 6] })
  doc.roundedRect(left + width - 105, y - 8, 90, 30, 4).lineWidth(2).strokeColor(green).stroke()
  doc.fillColor(green).font("Helvetica-Bold").fontSize(16).text("PAID", left + width - 105, y, { width: 90, align: "center" })
  doc.restore()

  doc.font("Helvetica").fontSize(8).fillColor("#777")
    .text(`Thank you for choosing WasteCore. Questions? WhatsApp +${businessNumber()}`, left, doc.page.height - 60, { width, align: "center" })
  doc.end()
}

// ================= BROADCASTS =================
// Announcements from the dashboard to a group of customers. Customers who
// haven't messaged recently only get approved templates, so this uses a
// Marketing template (WAPI_TEMPLATE_ANNOUNCEMENT):
//   name: "announcement"   category: Marketing
//   body: "Hello {{1}}, {{2}}
//
//          Reply UNSUBSCRIBE to stop these updates."
// Customers who reply UNSUBSCRIBE are skipped (customers/{id}.broadcastOptOut).
const TEMPLATE_ANNOUNCEMENT = process.env.WAPI_TEMPLATE_ANNOUNCEMENT || "announcement"
const BROADCAST_AUDIENCES = ["all", "subscribers", "business", "household", "recent"]

// phone (whatsapp:+234...) -> name, for an audience.
async function broadcastRecipients(audience) {
  const recipients = new Map()
  const add = (phone, name) => {
    const id = toWhatsAppId(phone)
    if (id && !recipients.has(id)) recipients.set(id, String(name || "").trim())
    else if (id && name && !recipients.get(id)) recipients.set(id, String(name).trim())
  }
  const subs = await activeSubscriptions()
  if (audience === "subscribers" || audience === "business" || audience === "household") {
    for (const s of subs) {
      const category = subscriptionPlanId(s.data).split("_")[0]
      if (audience !== "subscribers" && category !== audience) continue
      add(s.data.customerPhone, s.data.customerName)
    }
  } else {
    const cutoff = new Date(Date.now() - 60 * 86400000).toISOString()
    const cols = ["instantPickups", "pickupRequests", "upgradeRequests", "wasteBagOrders"]
    const snaps = await Promise.all(cols.map((c) => db.collection(c).get()))
    for (const snap of snaps) {
      for (const d of snap.docs) {
        const data = d.data()
        if (audience === "recent" && String(data.createdAt || "") < cutoff) continue
        add(data.customerPhone, data.customerName)
      }
    }
    if (audience === "all") {
      for (const s of subs) add(s.data.customerPhone, s.data.customerName)
      const customers = await db.collection("customers").get()
      for (const d of customers.docs) add(d.data().phone || d.id, d.data().name || d.data().businessName)
    }
  }
  // Skip customers who unsubscribed.
  const optedOut = await db.collection("customers").where("broadcastOptOut", "==", true).get()
  for (const d of optedOut.docs) recipients.delete(toWhatsAppId(d.data().phone || d.id))
  return recipients
}

// Sends in the background, about 3 per second, updating broadcasts/{id}.
async function runBroadcast(ref, recipients, message) {
  let sent = 0
  let failed = 0
  let i = 0
  for (const [phone, name] of recipients) {
    const status = await notifyCustomer(
      phone,
      TEMPLATE_ANNOUNCEMENT,
      [displayName(name) || "there", message],
      `\u{1F4E2} *WasteCore update*\n\nHello ${displayName(name) || "there"}, ${message}\n\n_Reply UNSUBSCRIBE to stop these updates._`
    ).catch(() => "failed")
    if (status === "failed") failed++
    else sent++
    if (++i % 10 === 0) await ref.update({ sent, failed }).catch(() => {})
    await new Promise((r) => setTimeout(r, 300))
  }
  await ref.update({ sent, failed, status: "done", finishedAt: new Date().toISOString() })
}

// ================= RATINGS =================
// After a pickup is completed the customer is asked for 1-5 stars (a
// tappable list; it reaches them if they messaged within 24 hours). Their
// answer is accepted for RATING_DAYS, also typed as a single digit. Low
// ratings ask what went wrong and alert the admins.
const RATING_DAYS = 3
const RATING_OPTIONS = [
  { id: "rate_5", title: "\u2B50\u2B50\u2B50\u2B50\u2B50 Excellent" },
  { id: "rate_4", title: "\u2B50\u2B50\u2B50\u2B50 Good" },
  { id: "rate_3", title: "\u2B50\u2B50\u2B50 Okay" },
  { id: "rate_2", title: "\u2B50\u2B50 Poor" },
  { id: "rate_1", title: "\u2B50 Very poor" },
]

async function askForRating(collectionName, id, job) {
  const phone = toWhatsAppId(job.customerPhone)
  if (!phone || job.rating) return
  await saveCustomer(phone, {
    pendingRating: { collection: collectionName, id, until: new Date(Date.now() + RATING_DAYS * 86400000).toISOString() },
  })
  const body = "\u{1F64F} *How was your pickup?*\n\nYour rating helps us improve. Tap below, or reply with a number from 1 (very poor) to 5 (excellent)."
  const sent = await sendWhatsAppChoices(phone, { body, options: RATING_OPTIONS, button: "Rate pickup" })
  if (!sent) await sendWhatsAppMessage(phone, body)
}

// Service area: a shared pin further than SERVICE_RADIUS_KM from the
// centre of SERVICE_AREA is flagged (the customer can still book).
const SERVICE_CENTER = String(process.env.SERVICE_CENTER || "4.9267,6.2676").split(",").map(Number) // Yenagoa
const SERVICE_RADIUS_KM = Number(process.env.SERVICE_RADIUS_KM || 30)
// Instant pickups booked after this hour (Nigerian time) are collected the next day.
const INSTANT_CUTOFF_HOUR = Number(process.env.INSTANT_CUTOFF_HOUR || 16)

function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

function outsideServiceArea(location) {
  if (!Number.isFinite(location?.lat) || SERVICE_CENTER.some((n) => !Number.isFinite(n))) return false
  return distanceKm({ lat: SERVICE_CENTER[0], lng: SERVICE_CENTER[1] }, location) > SERVICE_RADIUS_KM
}

const instantCutoffPassed = () => lagosHour() >= INSTANT_CUTOFF_HOUR
const cutoffLabel = () => {
  const h = INSTANT_CUTOFF_HOUR
  return `${h % 12 || 12}${h < 12 ? "am" : "pm"}`
}

// ================= AUTOMATIC REMINDERS =================
// Customers with a pickup tomorrow get a reminder in the evening, and
// subscriptions get a renewal reminder a few days before they expire.
// Customers may not have messaged recently, so the pickup reminder needs an
// approved template (WAPI_TEMPLATE_PICKUP_REMINDER), category Utility:
//   name: "pickup_reminder"
//   body: "Hello {{1}}, a reminder that your WasteCore pickup is tomorrow,
//          {{2}}, at {{3}}. Please have your waste bagged and ready.
//          Reply HI if you need to make a change."
const TEMPLATE_PICKUP_REMINDER = process.env.WAPI_TEMPLATE_PICKUP_REMINDER || "pickup_reminder"
const PICKUP_REMINDER_HOUR = Number(process.env.PICKUP_REMINDER_HOUR || 17) // Nigerian time
// Automatic renewal reminder this many days before paidUntil (0 turns it off).
const AUTO_RENEWAL_DAYS_BEFORE = Number(process.env.AUTO_RENEWAL_DAYS_BEFORE ?? 3)
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const lagosHour = (now = new Date()) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "numeric", hourCycle: "h23" }).format(now))

// Runs `task` at most once per day, after `fromHour` and before `toHour`.
async function oncePerDay(markerId, fromHour, toHour, task) {
  const hour = lagosHour()
  if (hour < fromHour || hour >= toHour) return
  const today = lagosToday()
  const markerRef = db.collection("config").doc(markerId)
  const claimed = await db.runTransaction(async (t) => {
    const snap = await t.get(markerRef)
    if (snap.exists && snap.data().lastDate === today) return false
    t.set(markerRef, { lastDate: today, ranAt: new Date().toISOString() }, { merge: true })
    return true
  })
  if (claimed) await task(today)
}

// Active subscriptions: dashboard subscribers plus WhatsApp plans not yet
// managed as subscribers. Returns [{ collection, id, data }].
async function activeSubscriptions() {
  const [subscribers, requests] = await Promise.all([
    db.collection("subscribers").get(),
    db.collection("upgradeRequests").get(),
  ])
  const linked = new Set(subscribers.docs.map((d) => d.data().linkedRequestId).filter(Boolean))
  return [
    ...subscribers.docs.filter((d) => d.data().status === "active").map((d) => ({ collection: "subscribers", id: d.id, ref: d.ref, data: d.data() })),
    ...requests.docs.filter((d) => !linked.has(d.id) && d.data().status !== "cancelled")
      .map((d) => ({ collection: "upgradeRequests", id: d.id, ref: d.ref, data: d.data() })),
  ]
}

async function sendAutomaticRenewalReminders() {
  if (!(AUTO_RENEWAL_DAYS_BEFORE > 0)) return
  await oncePerDay("autoRenewalReminders", COLLECTOR_SUMMARY_HOUR, 12, async (today) => {
    let count = 0
    for (const sub of await activeSubscriptions()) {
      const paidUntil = sub.data.paidUntil
      if (!paidUntil || !monthlyPrice(subscriptionPlanId(sub.data))) continue
      const daysLeft = Math.round((Date.parse(`${paidUntil}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)
      // Within the window (also catches a day missed while the server was
      // down), once per paid period; renewing moves paidUntil and re-arms it.
      if (daysLeft < 0 || daysLeft > AUTO_RENEWAL_DAYS_BEFORE) continue
      if (sub.data.autoRenewalReminderFor === paidUntil) continue
      await sub.ref.update({ autoRenewalReminderFor: paidUntil, renewalReminderRequestedAt: new Date().toISOString() })
      count++
    }
    if (count) console.log(`Automatic renewal reminders requested for ${count} subscription(s)`)
  })
}

async function sendPickupReminders() {
  await oncePerDay("pickupReminders", PICKUP_REMINDER_HOUR, 21, async (today) => {
    const tomorrow = addDays(today, 1)
    const weekday = WEEKDAY_NAMES[new Date(`${tomorrow}T00:00:00Z`).getUTCDay()]
    // phone -> { name, when, address }; one reminder per customer.
    const due = new Map()
    const add = (phone, name, timeWindow, address) => {
      const id = toWhatsAppId(phone)
      if (!id || due.has(id)) return
      due.set(id, { name, when: `${shortDay(tomorrow)}${timeWindow ? `, ${timeWindow}` : ""}`, address })
    }

    const [scheduled, instant] = await Promise.all([
      db.collection("pickupRequests").where("pickupDate", "==", tomorrow).get(),
      db.collection("instantPickups").where("pickupDate", "==", tomorrow).get(),
    ])
    for (const d of [...scheduled.docs, ...instant.docs]) {
      const job = d.data()
      if (OPEN_JOB_STATUSES.includes(job.status)) add(job.customerPhone, job.customerName, job.timeWindow, job.address)
    }
    for (const sub of await activeSubscriptions()) {
      const s = sub.data
      if (sub.collection !== "subscribers") continue // WhatsApp plans have no pickup days until scheduled
      if (!Array.isArray(s.pickupDays) || !s.pickupDays.includes(weekday)) continue
      if (s.startDate && s.startDate > tomorrow) continue
      if (s.paidUntil && s.paidUntil < tomorrow) continue // expired: the renewal reminder covers it
      add(s.customerPhone, s.customerName, SUBSCRIPTION_TIME_WINDOWS[s.timeWindow], s.address)
    }

    let sent = 0
    for (const [phone, r] of due) {
      const name = String(r.name || "").trim() || "there"
      const status = await notifyCustomer(
        phone,
        TEMPLATE_PICKUP_REMINDER,
        [name, r.when, r.address || "your address"],
        [
          `\u23F0 *Pickup reminder*`,
          "",
          `Hello ${name}, your WasteCore pickup is *tomorrow, ${r.when}*.`,
          ...(r.address ? [`\u{1F4CD} ${r.address}`] : []),
          "",
          "Please have your waste bagged and ready. Reply *hi* if you need to make a change.",
        ].join("\n")
      )
      if (status !== "failed") sent++
    }
    console.log(`Pickup reminders sent to ${sent} of ${due.size} customer(s) for ${tomorrow}`)
  })
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
function toWhatsAppId(raw) {
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
  const phone = toWhatsAppId(data.customerPhone)
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
  let initialLoad = true
  db.collection("subscribers").onSnapshot(
    (snapshot) => {
      const isInitial = initialLoad
      initialLoad = false
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === "removed") return
        await sendRenewalReminderIfRequested("subscribers", change.doc)
          .catch((err) => console.error(`Renewal reminder failed for subscribers/${change.doc.id}:`, err))
        await issueSubscriptionReceipts("subscribers", change.doc, isInitial)
          .catch((err) => console.error(`Receipt failed for subscribers/${change.doc.id}:`, err))
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
async function sendWhatsAppMedia(to, { type, url, caption, filename, phoneNumberId }) {
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
        [type]: {
          link: url,
          ...(caption ? { caption: caption.slice(0, 1024) } : {}),
          ...(type === "document" && filename ? { filename } : {}),
        },
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

/**
 * Sends tappable choices: up to 3 reply buttons, or a list (up to 10 rows,
 * used when there are more options or descriptions). Customers can still
 * type the number. Returns false if WhatsApp refused it, so the caller can
 * send the numbered text instead.
 */
async function sendWhatsAppChoices(to, { body, options, button = "Choose", footer, phoneNumberId }) {
  const numberId = whatsAppNumberId(phoneNumberId)
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  const phone = normalizePhone(to).replace(/\D/g, "")
  if (!numberId || !token || !phone || !options?.length || options.length > 10) return false
  const asButtons = options.length <= 3 && options.every((o) => !o.description && o.title.length <= 20)
  const interactive = asButtons
    ? {
        type: "button",
        body: { text: body.slice(0, 1024) },
        ...(footer ? { footer: { text: footer.slice(0, 60) } } : {}),
        action: { buttons: options.map((o) => ({ type: "reply", reply: { id: o.id, title: o.title.slice(0, 20) } })) },
      }
    : {
        type: "list",
        body: { text: body.slice(0, 4096) },
        ...(footer ? { footer: { text: footer.slice(0, 60) } } : {}),
        action: {
          button: button.slice(0, 20),
          sections: [{
            title: "Options",
            rows: options.map((o) => ({
              id: o.id,
              title: o.title.slice(0, 24),
              ...(o.description ? { description: o.description.slice(0, 72) } : {}),
            })),
          }],
        },
      }
  try {
    const res = await axios.post(
      `https://graph.facebook.com/v19.0/${numberId}/messages`,
      { messaging_product: "whatsapp", recipient_type: "individual", to: phone, type: "interactive", interactive },
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, timeout: 15000 }
    )
    return Boolean(res.data?.messages?.[0]?.id)
  } catch (err) {
    console.error("WhatsApp choices message failed, sending text instead:", err.response?.data?.error?.message || err.message)
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
        `\u{1F4CD} ${d.address}${d.location ? " (\u{1F4CC} pin shared)" : ""}`,
        `\u{1F4C5} Starts ${displayDate(d.startDate)}`,
      ],
      totalText: `${naira(amount)}/month`,
      doc: {
        // Business plans are booked under the business name.
        customerName: d.planCategory === "business" ? (d.businessName || d.name) : d.name,
        businessName: d.planCategory === "business" ? (d.businessName ?? null) : null,
        contactName: d.name ?? null,
        customerPhone: from, address: d.address, location: d.location ?? null, outsideArea: d.outsideArea === true,
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
        `\u{1F4CD} Deliver to: ${d.address}${d.location ? " (\u{1F4CC} pin shared)" : ""}`,
      ],
      totalText: naira(d.bagTotal),
      doc: {
        customerName: d.name, customerPhone: from, bagSize: d.bagSize, quantity: d.bagQuantity,
        totalAmount: d.bagTotal, deliveryAddress: d.address, location: d.location ?? null, outsideArea: d.outsideArea === true, serviceType: "wasteBags",
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
      `\u{1F4CD} ${d.address}${d.location ? " (\u{1F4CC} pin shared)" : ""}`,
      when,
    ],
    totalText: naira(amount),
    doc: {
      customerName: d.name, customerPhone: from, address: d.address, location: d.location ?? null, outsideArea: d.outsideArea === true,
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
    const url = await initializePaystack(reference, checkout.amount, from, checkout.description)
    if (!url) await db.collection("pendingPayments").doc(reference).update({ status: "init_failed" }).catch(() => {})
    return url
  } catch (err) {
    console.error("Could not save the pending payment:", err.message)
    return null
  }
}

// Starts a Paystack transaction and returns its checkout URL (or null).
async function initializePaystack(reference, amount, from, description) {
  const phoneDigits = normalizePhone(from).replace(/\D/g, "")
  try {
    const res = await axios.post(
      `${PAYSTACK_API}/transaction/initialize`,
      {
        // Paystack requires an email; WhatsApp customers don't give one.
        email: `${phoneDigits}@${PAYSTACK_EMAIL_DOMAIN}`,
        amount: Math.round(amount * 100), // kobo
        currency: "NGN",
        reference,
        ...(PUBLIC_BASE_URL ? { callback_url: `${PUBLIC_BASE_URL}/paystack/callback` } : {}),
        metadata: {
          customerPhone: normalizePhone(from),
          custom_fields: [
            { display_name: "Service", variable_name: "service", value: description },
            { display_name: "WhatsApp", variable_name: "whatsapp", value: normalizePhone(from) },
          ],
        },
      },
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }, timeout: 15000 }
    )
    return res.data?.data?.authorization_url || null
  } catch (err) {
    console.error("Paystack initialize failed:", err.response?.data || err.message)
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
    const today = lagosToday()
    const payment = { date: today, amount: p.amount, method: "paystack", reference, months: p.months || 1 }

    // Renewal: extend the subscription from its current paid-until date (or
    // today, if it has already run out).
    if (p.kind === "renewal") {
      const targetRef = db.collection(p.target.collection).doc(p.target.id)
      const targetSnap = await t.get(targetRef)
      if (!targetSnap.exists) {
        t.update(pendingRef, { status: "paid", note: "subscription not found", paidAt: new Date().toISOString() })
        return { outcome: "created", p, renewal: { missing: true } }
      }
      const current = targetSnap.data()
      const periodStart = laterDate(current.paidUntil, today)
      const paidUntil = addMonthsIso(periodStart, p.months || 1)
      t.update(targetRef, {
        lastPaymentDate: today,
        lastPaymentAmount: p.amount,
        lastPaymentMethod: "paystack",
        paidUntil,
        payments: [...(current.payments || []), payment].slice(-36),
        updatedAt: new Date().toISOString(),
      })
      t.update(pendingRef, { status: "paid", paidAt: new Date().toISOString() })
      return { outcome: "created", p, renewal: { current, periodStart, paidUntil } }
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
      // Monthly plans: first month paid from the start date.
      ...(p.collection === "upgradeRequests" ? {
        lastPaymentDate: today,
        lastPaymentAmount: p.amount,
        lastPaymentMethod: "paystack",
        paidUntil: addMonthsIso(laterDate(p.doc?.startDate, today), 1),
        payments: [payment],
      } : {}),
    }))
    t.update(pendingRef, { status: "paid", bookingCollection: p.collection, bookingId: bookingRef.id, paidAt: new Date().toISOString() })
    return { outcome: "created", p, datePassed, bookedDate }
  })

  if (result.outcome === "created" && result.renewal) {
    await confirmRenewal(result.p, result.renewal)
  } else if (result.outcome === "created") {
    const message = result.datePassed
      ? `${result.p.confirmation}\n\n\u26A0\uFE0F The date you chose (${displayDate(result.bookedDate)}) has already passed, ` +
        `so our team will contact you to agree a new date.`
      : result.p.confirmation
    await sendWhatsAppMessage(result.p.customerPhone, message)
  } else if (result.outcome === "unknown" && String(reference).startsWith("WC-")) {
    await reportUnmatchedPayment(reference, paidKobo, customerPhone)
  } else if (result.outcome === "amount_mismatch") {
    console.error(`Paystack amount mismatch for ${reference}: paid ${paidKobo} kobo, expected ${result.p.amount * 100}`)
    await notifyAdmins({
      key: `mismatch_${reference}`,
      type: "payment",
      section: "payments",
      title: "Payment amount doesn't match",
      body: `Paystack ${reference}: paid ${naira(Number(paidKobo) / 100)}, expected ${naira(result.p.amount)}. Contact the customer.`,
    })
    await sendWhatsAppMessage(result.p.customerPhone,
      "We received a payment that doesn't match your booking total. Our team will contact you shortly.")
  }
  return result.outcome
}

// Thanks the customer for a renewal and confirms the new paid-until date.
async function confirmRenewal(p, renewal) {
  if (renewal.missing) {
    console.error(`Renewal paid for a subscription that no longer exists (${p.target.collection}/${p.target.id})`)
    await reportUnmatchedPayment(`renewal-${p.target.id}`, Math.round(p.amount * 100), normalizePhone(p.customerPhone))
    return
  }
  const data = renewal.current
  const name = String(data.customerName || "").trim() || "there"
  const plan = subscriptionPlanText(p.planId).label
  const days = Array.isArray(data.pickupDays) ? data.pickupDays : []
  const time = SUBSCRIPTION_TIME_WINDOWS[data.timeWindow]
  const schedule = days.length ? `${joinDays(days)}${time ? `, ${time}` : ""}` : "as scheduled"
  await notifyAdmins({
    key: `renewal_${p.target.collection}_${p.target.id}_${renewal.paidUntil}`,
    type: "payment",
    section: "subscriptions",
    title: "Subscription renewed",
    body: `${name} · ${plan} · ${naira(p.amount)} paid (Paystack) · now paid until ${displayDate(renewal.paidUntil)}`,
  })
  await notifyCustomer(
    p.customerPhone,
    TEMPLATE_SUBSCRIPTION,
    [name, plan, schedule, displayDate(renewal.periodStart)],
    [
      `\u2705 *Subscription renewed!*`,
      "",
      `Thank you, ${name}. Your *${plan}* subscription is paid until *${displayDate(renewal.paidUntil)}*.`,
      `\u{1F5D3} Pickups: ${schedule}`,
      `\u{1F4B0} Paid: ${naira(p.amount)}`,
    ].join("\n")
  )
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
    const renewals = await deleteOlderThan("renewals", "createdAt", 90)
    await deleteOlderThan("notifications", "createdAt", 30)
    if (messages || links || renewals) {
      console.log(`Cleanup: removed ${messages} old message markers, ${links} unpaid payment links, ${renewals} old renewal links`)
    }
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
      const from = rawPhone
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

      // Shared location pin (📎 → Location).
      const loc = msgType === "location" ? message.location : null
      const location = loc && Number.isFinite(Number(loc.latitude)) && Number.isFinite(Number(loc.longitude))
        ? {
            lat: Number(loc.latitude),
            lng: Number(loc.longitude),
            name: String(loc.name || "").slice(0, 200),
            address: String(loc.address || "").slice(0, 300),
          }
        : null

      const messageId = message.id || null
      // `msg` is lowercased for matching commands and menu choices; `rawMsg`
      // keeps what the customer typed for names, addresses and descriptions.
      const phoneNumberId = value?.metadata?.phone_number_id || null
      const displayNumber = value?.metadata?.display_phone_number || null
      // A tapped button or list row: match on its id (the menu number).
      const replyId = msgType === "interactive"
        ? message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || ""
        : ""
      return {
        from: from, msg: (replyId || text).toLowerCase().substring(0, 500), rawMsg: text,
        hasImage, mediaId, mediaType, unsupportedMedia, messageId, phoneNumberId, displayNumber, location,
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

  async function uploadImageToCloudinary(imageBuffer, from, mediaType = "image", kind = "receipt") {
    return new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            folder: kind === "proof" ? "waste-connect/pickup-proof" : "waste-connect/receipts",
            // Cloudinary stores PDFs as "image" assets, so the dashboard
            // can show a preview of the first page.
            resource_type: "image",
            ...(mediaType === "pdf" ? { format: "pdf" } : {}),
            public_id: `${kind}_${from.replace(/whatsapp:\+?/i, "")}_${Date.now()}`,
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

  // Returns the saved receipt's (or collector's proof photo's) URL, or null
  // if it couldn't be downloaded or stored (they're asked to send it again).
  async function handleReceiptUpload(mediaId, from, mediaType, kind = "receipt") {
    let buffer
    try {
      buffer = await downloadMetaMedia(mediaId)
    } catch (err) {
      console.error("Receipt download from WhatsApp failed:", err.response?.data || err.message)
      return null
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await uploadImageToCloudinary(buffer, from, mediaType, kind)
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

  // ── Collector commands ────────────────────────────────────────────────────
  function collectorCommand(msg, hasImage) {
    if (/^(my\s+)?(jobs?|pickups?)[\s.!?]*$/.test(msg)) return "jobs"
    if (/^(done|completed?|picked(\s+up)?)\s*(job\s*)?#?\s*\d+/.test(msg)) return "done"
    if (/^(failed|fail|missed|not\s+done|couldn'?t(\s+pick(\s+up)?)?)\s*(job\s*)?#?\s*\d+/.test(msg)) return "failed"
    if (/^skip[\s.!]*$/.test(msg)) return "skip"
    if (hasImage) return "photo"
    return null
  }

  // Returns true when the message was a collector command (and was answered);
  // false lets it continue as a normal customer message.
  async function handleCollectorCommand(collector, command, { from, msg, rawMsg, mediaId, mediaType }) {
    const reply = (text) => sendWhatsAppMessage(from, text)
    const listRef = db.collection("collectorJobLists").doc(collector.id)
    const now = new Date().toISOString()

    if (command === "jobs") {
      await reply(await collectorJobsMessage(collector))
      return true
    }

    if (command === "done" || command === "failed") {
      const n = Number(msg.match(/\d+/)[0])
      const job = await collectorJob(collector, n)
      if (job.error) { await reply(job.error); return true }
      const who = job.data.customerName || "the customer"
      if (command === "done") {
        await job.ref.update({
          collectorReport: { status: "done", at: now, collectorId: collector.id, collectorName: collector.name || "", photoUrl: null },
          updatedAt: now,
        })
        // The next photo they send in the hour is the proof for this job.
        await listRef.set({ awaitingPhoto: { ...job.entry, until: new Date(Date.now() + 60 * 60 * 1000).toISOString() } }, { merge: true })
        await notifyAdmins({
          key: `report_${job.entry.collection}_${job.entry.id}_${now}`,
          type: "collector",
          section: "collectors",
          title: `${collector.name || "A collector"} reported a pickup done`,
          body: `${who}${job.data.address ? ` · ${job.data.address}` : ""}. Confirm it on the Collectors page.`,
        })
        await reply(
          `\u2705 Thanks! Job ${n} (${who}) is reported as done.\n\n` +
          `\u{1F4F8} Send a photo of the collected waste as proof, or reply *SKIP*.`
        )
      } else {
        // Reason: whatever follows the job number, as typed.
        const reason = rawMsg.replace(/^[^\d]*\d+\s*[-:,.]?\s*/, "").trim().slice(0, 200) || "No reason given"
        await job.ref.update({
          collectorReport: { status: "failed", at: now, reason, collectorId: collector.id, collectorName: collector.name || "" },
          updatedAt: now,
        })
        await notifyAdmins({
          key: `report_${job.entry.collection}_${job.entry.id}_${now}`,
          type: "collector",
          section: "collectors",
          title: `${collector.name || "A collector"} couldn't pick up`,
          body: `${who} · ${reason}`,
        })
        await reply(`\u274C Noted: job ${n} (${who}) couldn't be picked up${reason !== "No reason given" ? ` (${reason})` : ""}. The admin will follow up.`)
      }
      return true
    }

    // A photo or SKIP only counts after DONE; otherwise it's a normal message.
    const awaiting = (await listRef.get()).data()?.awaitingPhoto
    if (!awaiting || Date.parse(awaiting.until) < Date.now()) return false
    const jobRef = db.collection(awaiting.collection).doc(awaiting.id)
    if (command === "skip") {
      await listRef.set({ awaitingPhoto: null }, { merge: true })
      await reply("OK, no photo. The admin will confirm the pickup.")
      return true
    }
    const photoUrl = await handleReceiptUpload(mediaId, from, mediaType, "proof")
    if (!photoUrl) {
      await reply("Sorry, the photo didn't save. Please send it again, or reply *SKIP*.")
      return true
    }
    const jobSnap = await jobRef.get()
    if (jobSnap.exists) {
      await jobRef.update({ collectorReport: { ...(jobSnap.data().collectorReport || {}), photoUrl }, updatedAt: now })
    }
    await listRef.set({ awaitingPhoto: null }, { merge: true })
    await reply("\u{1F4F8} Photo saved. The admin will confirm the pickup.")
    return true
  }

  async function handleIncoming({
    from, msg, rawMsg = "", hasImage, mediaId, mediaType, unsupportedMedia, messageId, phoneNumberId, displayNumber, location,
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

    // Announcements opt-out / opt-in.
    if (/^(unsubscribe|stop updates|stop promos?)[\s.!]*$/.test(msg)) {
      await saveCustomer(from, { broadcastOptOut: true })
      await sendWhatsAppMessage(from, "You won't receive WasteCore announcements any more. Reply *START UPDATES* to get them again. Your bookings and pickup messages are not affected.")
      return
    }
    // ("subscribe" alone is left for customers who want a monthly plan.)
    if (/^(start updates|subscribe( to)? updates)[\s.!]*$/.test(msg)) {
      await saveCustomer(from, { broadcastOptOut: false })
      await sendWhatsAppMessage(from, "\u2705 You'll receive WasteCore announcements again. Reply *UNSUBSCRIBE* anytime to stop.")
      return
    }

    // Collectors: JOBS, DONE 2, FAILED 2 reason, a proof photo, SKIP.
    const command = collectorCommand(msg, hasImage)
    if (command) {
      const collector = await findCollectorByPhone(from)
      if (collector && await handleCollectorCommand(collector, command, { from, msg, rawMsg, mediaId, mediaType })) return
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

    // Tappable choices, or the same choices as numbered text.
    const sendChoices = async ({ body, options, button, footer, fallback }) => {
      if (await sendWhatsAppChoices(from, { body, options, button, footer, phoneNumberId })) return
      await send(fallback ?? `${body}\n\n${numberedOptions(options)}\n\nReply with a number.`)
    }

    // Loads the saved name (and business name) once per conversation.
    const ensureProfile = async () => {
      if (session.data.profileLoaded) return
      const profile = await loadCustomer(from)
      if (profile?.name && !session.data.name) session.data.name = profile.name
      if (profile?.businessName && !session.data.businessName) session.data.businessName = profile.businessName
      if (profile?.lastAddress?.address) session.data.savedAddress = profile.lastAddress
      session.data.profileLoaded = true
    }

    const sendServiceMenu = async () => {
      await ensureProfile()
      const greeting = session.data.name
        ? `Welcome back, ${displayName(session.data.name)}! \u{1F44B}`
        : "Welcome to WasteCore! \u267B\uFE0F"
      await sendChoices({
        body: `${greeting}\n\nWhat would you like to do?`,
        options: SERVICE_OPTIONS,
        button: "Choose service",
        footer: "Type cancel anytime to restart",
        fallback: `${greeting}\n\n${SERVICE_MENU}\n\nReply with a number. Type *cancel* anytime to restart.`,
      })
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
      await sendChoices({ body: "Ready to book? \u{1F447}", options: SERVICE_OPTIONS, button: "Choose service" })
      session.step = "1.5"
    }

    // ── My bookings: open pickups, bag orders and subscriptions ──────────
    const customerBookings = async () => {
      const today = lagosToday()
      const [open, subscriberSnap, planSnap] = await Promise.all([
        findActiveBookings(from, ["instantPickups", "pickupRequests", "wasteBagOrders"]),
        db.collection("subscribers").get(),
        db.collection("upgradeRequests").where("customerPhone", "==", from).get(),
      ])
      const items = open.map((b) => {
        const d = b.data
        if (b.collection === "wasteBagOrders") {
          return { ...b, kind: "order", title: `Waste bags \u00B7 ${d.bagSize || ""} \u00D7${d.quantity ?? 1}`, description: `Status: ${d.status}` }
        }
        return {
          ...b, kind: "pickup",
          title: `${d.serviceType === "instant" ? "Instant" : d.serviceType === "scheduled" ? "Scheduled" : "Pickup"}${d.pickupDate ? ` \u00B7 ${shortDay(d.pickupDate)}` : ""}`,
          description: `${d.timeWindow ? `${d.timeWindow.split(" (")[0]} \u00B7 ` : ""}Status: ${d.status}`,
        }
      })
      // Subscriptions: dashboard subscribers on this number, and WhatsApp
      // plans not yet managed as subscribers.
      const mine = subscriberSnap.docs.filter((d) => toWhatsAppId(d.data().customerPhone) === from && d.data().status !== "cancelled")
      const linked = new Set(subscriberSnap.docs.map((d) => d.data().linkedRequestId).filter(Boolean))
      const plans = planSnap.docs.filter((d) => !linked.has(d.id) && d.data().status !== "cancelled")
      for (const [collection, docs] of [["subscribers", mine], ["upgradeRequests", plans]]) {
        for (const d of docs) {
          const data = d.data()
          const until = data.paidUntil
          items.push({
            collection, id: d.id, ref: d.ref, data, kind: "plan",
            title: (() => {
              const [category, n] = subscriptionPlanId(data).split("_")
              return MONTHLY_PLANS[category] ? `${MONTHLY_PLANS[category].title} \u00B7 ${n}/week` : "Subscription"
            })(),
            description: !until ? "Payment not recorded yet"
              : until < today ? `Expired ${displayDate(until)}` : `Paid until ${displayDate(until)}`,
          })
        }
      }
      return items.slice(0, 10)
    }

    const showMyBookings = async () => {
      const items = await customerBookings()
      if (!items.length) {
        await send("You have no upcoming bookings or subscriptions right now.")
        await sendServiceMenu()
        return
      }
      session.data.myBookings = items.map((b) => ({ collection: b.collection, id: b.id, kind: b.kind }))
      await sendChoices({
        body: "\u{1F4CB} *Your bookings*\n\nChoose one to see what you can do.",
        options: items.map((b, i) => ({ id: String(i + 1), title: b.title, description: b.description })),
        button: "My bookings",
        fallback: `\u{1F4CB} *Your bookings*\n\n${items.map((b, i) => `${i + 1} - ${b.title}\n     ${b.description}`).join("\n")}\n\nReply with a number.`,
      })
      session.step = "my_bookings"
    }

    // Loads the chosen booking again (it may have changed) and offers its
    // actions, numbered ("cancel" itself would restart the conversation).
    const BOOKING_ACTION_TITLES = { renew: "Renew now", date: "Change date", cancel: "Cancel booking", back: "Back" }
    const showBookingActions = async (entry) => {
      const snap = await db.collection(entry.collection).doc(entry.id).get()
      const data = snap.exists ? snap.data() : null
      session.data.myBooking = entry
      if (!data) { await send("That booking can't be found any more."); session.step = "done"; return }
      let body
      let actions
      if (entry.kind === "plan") {
        const price = monthlyPrice(subscriptionPlanId(data))
        const plan = subscriptionPlanText(subscriptionPlanId(data)).label
        const status = !data.paidUntil ? "No payment recorded yet." : data.paidUntil < lagosToday()
          ? `Expired on ${displayDate(data.paidUntil)}.` : `Paid until ${displayDate(data.paidUntil)}.`
        body = `*${plan}*\n${status}${price ? `\n\u{1F4B0} ${naira(price)}/month` : ""}`
        actions = [...(price ? ["renew"] : []), "back"]
      } else if (!ACTIVE_STATUSES[entry.collection].includes(data.status)) {
        await send(`This booking is already ${data.status}.`)
        session.step = "done"
        return
      } else if (entry.kind === "order") {
        body = `*Waste bag order*\n${data.bagSize || ""} bags \u00D7 ${data.quantity ?? 1}\nStatus: ${data.status}`
        actions = ["cancel", "back"]
      } else {
        const when = data.pickupDate ? `${displayDate(data.pickupDate)}${data.timeWindow ? `, ${data.timeWindow}` : ""}` : ""
        body = `*${PICKUP_SERVICE_LABELS[data.serviceType] || "Pickup"}*${when ? `\n\u{1F4C5} ${when}` : ""}\n\u{1F4CD} ${data.address || ""}\nStatus: ${data.status}`
        actions = ["date", "cancel", "back"]
      }
      session.data.myBookingActions = actions
      await sendChoices({ body, options: actions.map((a, i) => ({ id: String(i + 1), title: BOOKING_ACTION_TITLES[a] })) })
      session.step = "my_booking_action"
    }

    // Cancels a pickup or bag order the customer chose, telling the team
    // (and the collector, if one was assigned).
    const cancelMyBooking = async (entry) => {
      const ref = db.collection(entry.collection).doc(entry.id)
      const snap = await ref.get()
      const data = snap.exists ? snap.data() : null
      if (!data || toWhatsAppId(data.customerPhone) !== from || !ACTIVE_STATUSES[entry.collection].includes(data.status)) {
        await send("That booking can no longer be cancelled. Choose Speak to Support if you need help.")
        return
      }
      const now = new Date().toISOString()
      await ref.update({ status: "cancelled", cancelledBy: "customer", cancelledAt: now, updatedAt: now })
      const paid = paymentVerified(data) || Boolean(data.paymentReceiptUrl)
      const what = entry.kind === "order" ? "waste bag order" : `pickup${data.pickupDate ? ` on ${displayDate(data.pickupDate)}` : ""}`
      await notifyAdmins({
        key: `cancel_${entry.collection}_${entry.id}`,
        type: "booking",
        section: entry.collection === "instantPickups" ? "instant-pickups" : entry.collection === "pickupRequests" ? "pickup-requests" : "waste-bag-orders",
        title: "Customer cancelled a booking",
        body: `${data.customerName || normalizePhone(from)} cancelled their ${what}${paid ? ". Paid: arrange a refund." : "."}`,
      })
      if (data.collectorId && entry.kind === "pickup") {
        const collector = await loadCollector(data.collectorId)
        const phone = toWhatsAppId(collector?.phone)
        if (phone) await sendWhatsAppMessage(phone, `\u274C *Pickup cancelled by the customer*\n\n${jobCustomer(data)}\n\u{1F4CD} ${data.address || ""}\n\u{1F4C5} ${shortDay(data.pickupDate)}`)
      }
      if (paid) {
        await db.collection("supportTickets").add({
          ticketId: `TKT-${Date.now().toString().slice(-6)}`,
          customerName: data.customerName || "",
          customerPhone: from,
          category: "Refund request",
          message: `Customer cancelled a paid ${what} (${naira(data.totalAmount ?? 0)}). Arrange a refund.`,
          contactTime: "anytime",
          relatedPickupId: entry.id,
          relatedCollection: entry.collection,
          status: "open",
          createdAt: now,
          updatedAt: now,
        })
      }
      await send(`\u2705 Your ${what} has been cancelled.${paid ? " Our team will contact you about your refund." : ""}`)
    }

    const showMonthlyPlans = async () => {
      const c = MONTHLY_PLANS[session.data.planCategory]
      await sendChoices({
        body: `*${c.title} Plans*${c.footer ? `\n\n${c.footer}` : ""}\n\nHow many pickups a week?`,
        options: [1, 2, 3].map((n) => ({
          id: String(n),
          title: `${n} pickup${n > 1 ? "s" : ""} per week`,
          description: `NGN ${c.prices[n].toLocaleString()}/month`,
        })),
        button: "Choose plan",
        fallback: monthlyPlansMenu(session.data.planCategory),
      })
      session.step = "upgrade_select"
    }

    const askPlanCategory = () => sendChoices({
      body: `*Monthly Subscription*\n\n\u{1F3E2} *Business*: ${MONTHLY_PLANS.business.blurb}\n\u{1F3E0} *Household*: ${MONTHLY_PLANS.household.blurb}`,
      options: [{ id: "1", title: "Business" }, { id: "2", title: "Household" }],
      fallback: SUBSCRIPTION_CATEGORY_MENU,
    })
    const askBagSize = () => sendChoices({
      body: "*Waste Bag Sizes*\n\nWhich size would you like?",
      options: BAG_SIZE_OPTIONS,
      button: "Choose size",
      fallback: `Waste Bag Sizes\n\n1 - Small  NGN 500 (pack of 10)\n2 - Medium  NGN 900 (pack of 10)\n3 - Large  NGN 1,500 (pack of 10)\n\nReply 1, 2, or 3.`,
    })
    const askSupportCategory = () => sendChoices({
      body: "*Support*\n\nWhat do you need help with?",
      options: SUPPORT_OPTIONS,
      button: "Choose topic",
    })

    // Sends the first question of the chosen service and moves to its step.
    const beginService = async () => {
      switch (session.data.serviceType) {
        case "upgrade":
          await askPlanCategory()
          session.step = "plan_category"
          break
        case "wasteBags":
          await askBagSize()
          session.step = "bags_select"
          break
        case "support":
          await askSupportCategory()
          session.step = "support_select"
          break
        default: // instant, scheduled
          await askAddress("Your pickup address?", "pickup")
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

    // ── Addresses: typed, a location pin, or both ─────────────────────────
    // Pins can be off in Bayelsa, so a typed address or landmark is always
    // accepted, and asked for after a pin (SKIP uses the pin alone).
    const ADDRESS_HOW =
      "\u270D\uFE0F Type the address with a nearby landmark, e.g. _12 Okaka Road, opposite First Bank_\n" +
      "\u{1F4CC} and/or share your location: tap \u{1F4CE} \u2192 *Location* \u2192 *Send your current location*"
    const pinLabel = (loc) => [loc?.name, loc?.address].filter(Boolean).join(", ") || "Location pin"

    const askAddress = async (question, kind) => {
      await ensureProfile()
      const saved = session.data.savedAddress
      const text = [
        `*${question}*`,
        "",
        ...(saved ? [`Reply *1* to use your last address:`, `\u{1F4CD} ${saved.address}${saved.location ? " (\u{1F4CC} pin)" : ""}`, "", "Or:"] : []),
        ADDRESS_HOW,
      ].join("\n")
      if (saved) {
        await sendChoices({
          body: text.replace("Reply *1* to use your last address:", "Your last address:"),
          options: [{ id: "1", title: "Use last address" }],
          fallback: text,
        })
      } else {
        await send(text)
      }
      session.step = `${kind}_address`
    }

    // What comes after the address for each service.
    const afterAddress = async (kind) => {
      saveCustomer(from, { lastAddress: { address: session.data.address, location: session.data.location ?? null } })
        .catch((err) => console.error("Could not save the last address:", err.message))
      if (kind === "upgrade") {
        await askDate("When should your plan start?")
        session.step = "upgrade_date"
      } else if (kind === "bags") {
        await startCheckout("bags_payment")
      } else {
        await askBagsOrDate()
      }
    }

    // A pin far outside the service area is flagged (booking still allowed).
    const checkServiceArea = async (loc) => {
      session.data.outsideArea = outsideServiceArea(loc)
      if (session.data.outsideArea) {
        await send(
          `\u26A0\uFE0F This location looks outside our current service area (${SERVICE_AREA}). ` +
          "You can still book, and our team will confirm with you before the pickup."
        )
      }
    }

    const handleAddressReply = async (kind) => {
      if (location) {
        session.data.location = location
        await checkServiceArea(location)
        await sendChoices({
          body: "\u{1F4CC} Got your location pin, thanks!\n\n" +
            "Now *type the address or a landmark* so the collector can find you easily (pins can be a little off).",
          options: [{ id: "skip", title: "Use pin only" }],
          fallback: "\u{1F4CC} Got your location pin, thanks!\n\n" +
            "Now *type the address or a landmark* so the collector can find you easily (pins can be a little off).\n\n" +
            "Reply *SKIP* to use the pin only.",
        })
        session.step = `${kind}_address_details`
        return
      }
      if (msg === "1" && session.data.savedAddress) {
        session.data.address = session.data.savedAddress.address
        session.data.location = session.data.savedAddress.location ?? null
        session.data.outsideArea = outsideServiceArea(session.data.location)
        return afterAddress(kind)
      }
      if (!rawMsg.trim()) {
        await send(`Please send your address.\n\n${ADDRESS_HOW}`)
        return
      }
      session.data.address = rawMsg.substring(0, 300)
      session.data.location = null
      session.data.outsideArea = false
      await afterAddress(kind)
    }

    const handleAddressDetails = async (kind) => {
      if (location) {
        session.data.location = location
        await checkServiceArea(location)
        await send("\u{1F4CC} Pin updated. Now type the address or a landmark, or reply *SKIP*.")
        return
      }
      if (/^skip[\s.!]*$/.test(msg)) {
        session.data.address = pinLabel(session.data.location)
      } else if (rawMsg.trim()) {
        session.data.address = rawMsg.substring(0, 300)
      } else {
        await send("Please type the address or a landmark, or reply *SKIP* to use the pin only.")
        return
      }
      await afterAddress(kind)
    }

    const DATE_HINT = "Reply *today*, *tomorrow* or a date like 30/03/2026."
    // Today / Tomorrow buttons; any other date can be typed.
    const askDate = (question) => sendChoices({
      body: `${question}\n\nTap a button or type a date like 30/03/2026.`,
      options: [{ id: "today", title: "Today" }, { id: "tomorrow", title: "Tomorrow" }],
      fallback: `${question}\n\n${DATE_HINT}`,
    })
    const askPickupDate = () => {
      if (session.data.serviceType === "instant" && instantCutoffPassed()) {
        return sendChoices({
          body: `When should we pick up?\n\nInstant pickups booked after ${cutoffLabel()} are collected the next day. Tap Tomorrow or type a later date like 30/03/2026.`,
          options: [{ id: "tomorrow", title: "Tomorrow" }],
          fallback: `When should we pick up?\n\nInstant pickups booked after ${cutoffLabel()} are collected the next day. Reply *tomorrow* or a later date like 30/03/2026.`,
        })
      }
      return askDate(session.data.serviceType === "scheduled" ? "Which date should we come?" : "When should we pick up?")
    }

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
      // ── Rating replies (tapped stars, or a single digit while idle) ─────
      const ratingTap = msg.match(/^rate_([1-5])$/)
      if (ratingTap || ((session.step === "0" || session.step === "done") && /^[1-5]$/.test(msg))) {
        const profile = await loadCustomer(from)
        const pending = profile?.pendingRating
        if (pending && Date.parse(pending.until) > Date.now()) {
          const stars = Number(ratingTap ? ratingTap[1] : msg)
          const jobRef = db.collection(pending.collection).doc(pending.id)
          const job = (await jobRef.get()).data() || {}
          await jobRef.update({ rating: { stars, at: new Date().toISOString() } })
          await saveCustomer(from, { pendingRating: null })
          if (stars <= 3) {
            await notifyAdmins({
              key: `rating_${pending.collection}_${pending.id}`,
              type: "support",
              section: "collectors",
              title: `${"\u2B50".repeat(stars)} Low rating (${stars}/5)`,
              body: `${job.customerName || normalizePhone(from)}${job.collectorName ? ` · collector ${job.collectorName}` : ""}. Waiting for their comment.`,
            })
            session = { step: "rating_comment", data: { ratingFor: pending, stars } }
            await send("We're sorry it wasn't great. \u{1F64F} What went wrong? Your answer goes straight to our team.")
            await sessionsRef.set(session)
          } else {
            await send(`Thank you for the ${stars}-star rating! \u{1F49A} Reply *hi* anytime to book again.`)
          }
          return
        }
        if (ratingTap) {
          await send("Thanks! This pickup was already rated. Reply *hi* to see the menu.")
          return
        }
      }

      if (session.step === "rating_comment") {
        const { ratingFor, stars } = session.data
        const comment = rawMsg.trim().slice(0, 500)
        const jobRef = db.collection(ratingFor.collection).doc(ratingFor.id)
        const job = (await jobRef.get()).data() || {}
        const now = new Date().toISOString()
        await jobRef.update({ rating: { ...(job.rating || { stars }), comment } })
        await db.collection("supportTickets").add({
          ticketId: `TKT-${Date.now().toString().slice(-6)}`,
          customerName: job.customerName || "",
          customerPhone: from,
          category: "Pickup feedback",
          message: `${stars}/5 stars${job.collectorName ? ` (collector ${job.collectorName})` : ""}: ${comment || "(no comment)"}`,
          contactTime: "anytime",
          relatedPickupId: ratingFor.id,
          relatedCollection: ratingFor.collection,
          status: "open",
          createdAt: now,
          updatedAt: now,
        })
        await send("Thank you for telling us. Our team will look into it and may contact you.")
        await sessionsRef.delete().catch(() => {})
        return
      }

      // ── Active request check (only at conversation start) ────────────────
      if (session.step === "0" || session.step === "0.5") {
        const [active] = await findActiveBookings(from)
        if (active) {
          const d = active.data
          const when = d.pickupDate ? `\n\u{1F4C5} ${displayDate(d.pickupDate)}${d.timeWindow ? ` \u00B7 ${d.timeWindow}` : ""}`
            : d.startDate ? `\n\u{1F4C5} Starts ${displayDate(d.startDate)}` : ""
          await ensureProfile()
          const intro =
            `${session.data.name ? `Welcome back, ${displayName(session.data.name)}! \u{1F44B}\n\n` : ""}` +
            `You have a booking in progress:\n\n*${bookingLabel(active)}*${when}\nStatus: ${d.status}\n\nWhat would you like to do?`
          await sendChoices({
            body: intro,
            options: [{ id: "1", title: "Book a service" }, { id: "2", title: "My bookings" }, { id: "3", title: "Support" }],
            fallback: `${intro}\n1 - Book another service\n2 - My bookings (change date, cancel, renew)\n3 - Speak to Support\n\nReply with a number.`,
          })
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
            await showMyBookings()
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
            await sendChoices({ body: "What would you like to do?", options: SERVICE_OPTIONS, button: "Choose service" })
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
          else if (msg === "7") { await showMyBookings(); break }
          else { await send("Reply with a number from 1 to 7."); break }
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
          await askAddress("Your pickup address?", "pickup")
          break

        // ── INSTANT & SCHEDULED PICKUP FLOW ────────────────────────────────
        case "pickup_address":
        case "upgrade_address":
        case "bags_address":
          await handleAddressReply(session.step.replace("_address", ""))
          break

        case "pickup_address_details":
        case "upgrade_address_details":
        case "bags_address_details":
          await handleAddressDetails(session.step.replace("_address_details", ""))
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
          let date = await readFutureDate()
          if (!date) break
          if (session.data.serviceType === "instant" && date === lagosToday() && instantCutoffPassed()) {
            date = addDays(date, 1)
            await send(`\u{1F552} Instant pickups booked after ${cutoffLabel()} are collected the next day, so we've set yours for *tomorrow, ${displayDate(date)}*.`)
          }
          session.data.pickupDate = date
          if (session.data.serviceType === "scheduled") {
            await sendChoices({
              body: "Preferred pickup time?",
              options: TIME_WINDOW_OPTIONS,
              fallback: "Preferred pickup time?\n\n1 - Morning (8am-12pm)\n2 - Afternoon (12pm-4pm)\n3 - Evening (4pm-7pm)\n\nReply 1, 2, or 3.",
            })
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
          await askPlanCategory()
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
          await askAddress("Your pickup address for this plan?", "upgrade")
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
          await askBagSize()
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
            await askAddress("Delivery address?", "bags")
          }
          break


        case "bags_payment":
          if (await saveReceiptBooking()) session.step = "done"
          break

        // ── SUPPORT FLOW ───────────────────────────────────────────────────
        case "support_category":
          await askSupportCategory()
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

        // ── MY BOOKINGS ────────────────────────────────────────────────────
        case "my_bookings": {
          const entry = session.data.myBookings?.[Number(msg) - 1]
          if (!/^\d+$/.test(msg) || !entry) { await send("Please choose one of your bookings, or type *cancel* to go back to the menu."); break }
          await showBookingActions(entry)
          break
        }

        case "my_booking_action": {
          const entry = session.data.myBooking
          const action = /^\d+$/.test(msg) ? session.data.myBookingActions?.[Number(msg) - 1] : null
          if (action === "back") { await showMyBookings(); break }
          if (action === "renew") {
            const snap = await db.collection(entry.collection).doc(entry.id).get()
            const data = snap.data() || {}
            const price = monthlyPrice(subscriptionPlanId(data))
            if (!price || !PUBLIC_BASE_URL) { await send("Online renewal isn't available for this plan. Choose Speak to Support and we'll help."); session.step = "done"; break }
            const { url } = await createRenewalLink(entry.collection, entry.id, from)
            const plan = subscriptionPlanText(subscriptionPlanId(data)).label
            const body = `\u{1F504} *Renew your subscription*\n\n*${plan}*\n\u{1F4B0} ${naira(price)} for 1 month\n\nTap *Pay* to pay securely by card, bank transfer or USSD.`
            const sentButton = await sendWhatsAppUrlButton(from, { body, buttonText: `Pay ${naira(price)}`, url, footer: "\u{1F512} Secured by Paystack", phoneNumberId })
            if (!sentButton) await send(`${body}\n\n${url}`)
            session.step = "done"
            break
          }
          if (action === "date") {
            const snap = await db.collection(entry.collection).doc(entry.id).get()
            session.data.changePickup = { collection: entry.collection, id: entry.id, oldDate: snap.data()?.pickupDate ?? null }
            await askDate("What new date would you like?")
            session.step = "change_date"
            break
          }
          if (action === "cancel") {
            await sendChoices({
              body: "Are you sure you want to cancel this booking?",
              options: [{ id: "yes", title: "Yes, cancel it" }, { id: "no", title: "No, keep it" }],
              fallback: "Are you sure you want to cancel this booking? Reply *YES* or *NO*.",
            })
            session.step = "my_booking_cancel"
            break
          }
          await send("Please reply with one of the numbers shown, or type *cancel* to go back to the menu.")
          break
        }

        case "my_booking_cancel":
          if (msg === "yes") {
            await cancelMyBooking(session.data.myBooking)
            session.step = "done"
          } else if (msg === "no") {
            await send("OK, your booking is unchanged.")
            session.step = "done"
          } else {
            await send("Please reply *YES* to cancel the booking or *NO* to keep it.")
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
  app.use(["/api/admin-auth/setup", "/api/sub-admins", "/api/push", "/api/broadcasts"], rateLimit)

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

  // Sub-admin permission switches (must match lib/permissions.ts).
  const SUB_ADMIN_PERMISSIONS = ["viewRevenue", "recordPayments", "deleteRecords", "sendBroadcasts"]

  // Activity log entries for actions taken through the server.
  async function logAdminActivity(uid, action, details = {}) {
    try {
      const profile = await db.collection("admins").doc(uid).get()
      await db.collection("activityLog").add({
        uid, username: profile.data()?.username || "", action, ...details, at: new Date().toISOString(),
      })
    } catch (err) {
      console.error("Activity log failed:", err.message)
    }
  }

  // Any signed-in, active admin (main or sub).
  async function requireAdmin(req, res, next) {
    try {
      const token = (req.headers.authorization || "").replace(/^Bearer /, "")
      const decoded = await admin.auth().verifyIdToken(token, true)
      const profile = await db.collection("admins").doc(decoded.uid).get()
      if (!profile.exists || profile.data().active === false) return res.status(403).json({ error: "Not an admin." })
      req.adminUid = decoded.uid
      next()
    } catch {
      res.status(401).json({ error: "Please sign in again." })
    }
  }

  // Main admin, or a sub-admin with the given permission switched on.
  const requirePermission = (permission) => async (req, res, next) => {
    const profile = await db.collection("admins").doc(req.adminUid).get()
    const data = profile.data() || {}
    if (data.role === "main" || data.permissions?.[permission] === true) return next()
    res.status(403).json({ error: "You don't have permission to do this. Ask the main admin." })
  }

  // ── Broadcasts ────────────────────────────────────────────────────────────
  // { audience, message, preview } -> { count } (preview) or { id, count }.
  app.post("/api/broadcasts", requireAdmin, requirePermission("sendBroadcasts"), async (req, res) => {
    const audience = String(req.body?.audience || "")
    const message = String(req.body?.message || "").replace(/\s+/g, " ").trim()
    if (!BROADCAST_AUDIENCES.includes(audience)) return res.status(400).json({ error: "Choose who to send to." })
    if (!req.body?.preview && (message.length < 5 || message.length > 900)) {
      return res.status(400).json({ error: "Write a message between 5 and 900 characters." })
    }
    try {
      const recipients = await broadcastRecipients(audience)
      if (req.body?.preview) return res.json({ count: recipients.size })
      if (!recipients.size) return res.status(400).json({ error: "No customers in this group." })
      const profile = await db.collection("admins").doc(req.adminUid).get()
      const ref = await db.collection("broadcasts").add({
        audience, message, total: recipients.size, sent: 0, failed: 0, status: "sending",
        createdBy: profile.data()?.username || "", createdAt: new Date().toISOString(),
      })
      await logAdminActivity(req.adminUid, "Sent broadcast", { audience, count: recipients.size, message: message.slice(0, 120) })
      res.json({ id: ref.id, count: recipients.size })
      runBroadcast(ref, recipients, message).catch((err) => {
        console.error("Broadcast failed:", err)
        ref.update({ status: "failed" }).catch(() => {})
      })
    } catch (err) {
      console.error("Broadcast setup failed:", err)
      res.status(500).json({ error: "Could not send the broadcast. Please try again." })
    }
  })

  // ── Push notifications for admins' devices ────────────────────────────────
  app.get("/api/push/key", async (req, res) => {
    const keys = await webPushKeys()
    if (!keys) return res.status(503).json({ error: "Notifications are not available right now." })
    res.json({ publicKey: keys.publicKey })
  })

  const subscriptionId = (endpoint) => crypto.createHash("sha256").update(String(endpoint)).digest("hex").slice(0, 40)

  app.post("/api/push/subscribe", requireAdmin, async (req, res) => {
    const sub = req.body?.subscription
    if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) {
      return res.status(400).json({ error: "Invalid subscription." })
    }
    await db.collection("pushSubscriptions").doc(subscriptionId(sub.endpoint)).set({
      subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
      uid: req.adminUid,
      userAgent: String(req.headers["user-agent"] || "").slice(0, 200),
      createdAt: new Date().toISOString(),
    })
    res.json({ ok: true })
  })

  app.post("/api/push/unsubscribe", requireAdmin, async (req, res) => {
    if (req.body?.endpoint) await db.collection("pushSubscriptions").doc(subscriptionId(req.body.endpoint)).delete().catch(() => {})
    res.json({ ok: true })
  })

  // Sends a test notification to the caller's own devices.
  app.post("/api/push/test", requireAdmin, async (req, res) => {
    const sent = await sendAdminPush({ title: "Notifications are on ✅", body: "You'll get WasteCore activity on this device.", section: "overview", tag: "test" }, req.adminUid)
    res.json({ sent })
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
      await logAdminActivity(req.adminUid, "Added sub-admin", { target: creds.username })
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

      // Permission switches: only known names, true/false.
      let permissions = null
      if (req.body?.permissions && typeof req.body.permissions === "object") {
        permissions = { ...(doc.data().permissions || {}) }
        for (const [key, value] of Object.entries(req.body.permissions)) {
          if (!SUB_ADMIN_PERMISSIONS.includes(key) || typeof value !== "boolean") {
            return res.status(400).json({ error: `Unknown permission: ${key}` })
          }
          permissions[key] = value
        }
      }

      if (!Object.keys(authUpdate).length && !permissions) return res.status(400).json({ error: "Nothing to update." })
      if (Object.keys(authUpdate).length) {
        await admin.auth().updateUser(req.params.uid, authUpdate)
        // Sign them out everywhere after a password change or deactivation.
        await admin.auth().revokeRefreshTokens(req.params.uid)
      }
      await doc.ref.update({
        ...(typeof req.body?.active === "boolean" ? { active: req.body.active } : {}),
        ...(permissions ? { permissions } : {}),
        updatedAt: new Date().toISOString(),
      })
      const changes = [
        authUpdate.password && "reset password",
        typeof req.body?.active === "boolean" && (req.body.active ? "activated" : "deactivated"),
        permissions && "changed permissions",
      ].filter(Boolean).join(", ")
      await logAdminActivity(req.adminUid, "Updated sub-admin", { target: doc.data().username, changes })
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
      await logAdminActivity(req.adminUid, "Deleted sub-admin", { target: doc.data().username })
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
    res.type("html").send(brandedPage({
      ok: paid,
      title: paid ? "Payment received" : "Payment not confirmed yet",
      body: paid
        ? "Thank you! Your payment is confirmed and the details are on WhatsApp. You can close this page."
        : "If you completed the payment, you'll get a WhatsApp confirmation shortly. Otherwise go back to WhatsApp and type <b>hi</b> to try again.",
    }))
  })

  // PDF receipts: the link (sent to the customer and shown to admins) is
  // the only way in; the token is random.
  app.get("/receipts/:file", async (req, res) => {
    const token = String(req.params.file).replace(/\.pdf$/i, "").slice(0, 64)
    try {
      const snap = await db.collection("receipts").doc(token).get()
      if (!snap.exists) return res.status(404).type("html").send(brandedPage({ ok: false, title: "Receipt not found", body: "This receipt link isn't valid. Message us on WhatsApp for a copy." }))
      renderReceiptPdf(snap.data(), res)
    } catch (err) {
      console.error("Receipt failed:", err)
      res.status(500).send("Could not load the receipt. Please try again.")
    }
  })

  // "Renew now" link from a renewal reminder: starts a fresh Paystack
  // payment for the subscription's plan and sends the customer to it.
  app.get("/renew/:token", async (req, res) => {
    const page = (title, body) => res.type("html").send(brandedPage({ ok: false, title, body }))
    try {
      const snap = await db.collection("renewals").doc(String(req.params.token).slice(0, 64)).get()
      if (!snap.exists) return page("Link not found", "This renewal link isn't valid. Message us on WhatsApp and we'll help you renew.")
      const renewal = snap.data()
      const target = await db.collection(renewal.collection).doc(renewal.id).get()
      if (!target.exists) return page("Subscription not found", "We couldn't find this subscription. Message us on WhatsApp and we'll help you renew.")
      const url = await createRenewalPayment(renewal, target.data())
      if (url) return res.redirect(303, url)
      const price = monthlyPrice(subscriptionPlanId(target.data()))
      return page(
        "Renew by bank transfer",
        `${price ? `Pay <b>${naira(price)}</b> to:<br>` : "Pay to:<br>"}${BANK_DETAILS.replace(/\n/g, "<br>")}<br><br>` +
        "Then send a photo of your receipt to us on WhatsApp."
      )
    } catch (err) {
      console.error("Renewal link failed:", err)
      return page("Something went wrong", "Please try again in a moment, or message us on WhatsApp.")
    }
  })

  // Branded page shown after payment and for renewal links.
  function brandedPage({ ok, title, body }) {
    const icon = ok ? "&#10003;" : "!"
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>WasteCore - ${title}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#eef6ee;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#17301d;padding:16px;box-sizing:border-box}
  .card{background:#fff;max-width:380px;width:100%;border-radius:18px;padding:32px 24px;text-align:center;
    box-shadow:0 10px 30px rgba(23,48,29,.10)}
  .brand{font-weight:700;color:#2e8b3a;letter-spacing:.3px;margin-bottom:20px}
  .icon{width:64px;height:64px;border-radius:50%;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;
    font-size:32px;font-weight:700;color:#fff;background:${ok ? "#2e8b3a" : "#e0a100"}}
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
</main></body></html>`
  }

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