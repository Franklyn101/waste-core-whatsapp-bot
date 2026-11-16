// Paystack: payment link, webhook signature, duplicates, wrong amounts,
// PDF receipts and subscription renewal links.
const test = require("node:test")
const assert = require("node:assert/strict")
const crypto = require("crypto")
const { startBot, quietDailyJobs, lagosDate } = require("./helpers/bot")

const SECRET = "sk_test_ci"
const bot = startBot({ env: { PAYSTACK_SECRET_KEY: SECRET }, seed: { ...quietDailyJobs() } })

function webhook(data, { signature } = {}) {
  const body = { event: "charge.success", data: { status: "success", currency: "NGN", channel: "card", ...data } }
  const rawBody = Buffer.from(JSON.stringify(body))
  const sig = signature ?? crypto.createHmac("sha512", SECRET).update(rawBody).digest("hex")
  return bot.runRoute("POST /paystack/webhook", { headers: { "x-paystack-signature": sig }, rawBody, body })
}

const pendingRef = () => Object.keys(bot.store).find((k) => k.startsWith("pendingPayments/") && bot.store[k].status === "pending")?.split("/")[1]

test("a booking gets a Pay button and is only saved once Paystack confirms", async () => {
  const phone = "2348200000001"
  await bot.say(phone, "hi")
  await bot.say(phone, "2")
  await bot.say(phone, "Ngozi")
  await bot.say(phone, "3 Kpansia Road")
  await bot.say(phone, "4")
  await bot.say(phone, "tomorrow")
  assert.match(await bot.say(phone, "2"), /Pay ₦2,600/)
  assert.equal(bot.all("pickupRequests").length, 0, "nothing saved before payment")

  const ref = pendingRef()
  assert.ok(ref)
  assert.equal((await webhook({ reference: ref, amount: 260000 }, { signature: "forged" })).status, 401)
  assert.equal(bot.all("pickupRequests").length, 0)

  assert.equal((await webhook({ reference: ref, amount: 260000 })).status, 200)
  await bot.wait()
  const booking = bot.find("pickupRequests", (b) => b.paymentReference === ref)
  assert.ok(booking, "booking created")
  assert.equal(booking.paymentMethod, "paystack")
  assert.equal(booking.pickupDate, lagosDate(1))

  await webhook({ reference: ref, amount: 260000 })
  assert.equal(bot.all("pickupRequests").length, 1, "a repeated webhook doesn't book twice")
})

test("a payment for the wrong amount is not booked", async () => {
  bot.store["pendingPayments/WC-WRONG"] = {
    collection: "instantPickups", doc: { customerPhone: "whatsapp:+2348200000002", serviceType: "instant" },
    amount: 2000, confirmation: "ok", customerPhone: "whatsapp:+2348200000002", status: "pending",
  }
  await webhook({ reference: "WC-WRONG", amount: 100000 })
  assert.equal(bot.store["pendingPayments/WC-WRONG"].status, "amount_mismatch")
  assert.equal(bot.all("instantPickups").length, 0)
})

test("a paid booking gets a numbered PDF receipt", async () => {
  const [key] = Object.entries(bot.store).find(([k, v]) => k.startsWith("pickupRequests/") && v.paymentMethod === "paystack")
  const id = key.split("/")[1]
  bot.sent.length = 0
  await bot.change("pickupRequests", id, "added")
  const booking = bot.store[key]
  assert.match(booking.receiptNumber, /^WC-\d{6}$/)
  assert.ok(bot.sent.some((m) => m.includes(`WasteCore-receipt-${booking.receiptNumber}.pdf`)), "PDF sent on WhatsApp")
  const chunks = []
  const { PassThrough } = require("stream")
  const res = new PassThrough()
  res.setHeader = () => {}
  res.on("data", (c) => chunks.push(c))
  const done = new Promise((r) => res.on("end", r))
  await bot.routes["GET /receipts/:file"][0]({ params: { file: `${booking.receiptToken}.pdf` } }, res)
  await done
  assert.equal(Buffer.concat(chunks).subarray(0, 5).toString(), "%PDF-")
})

test("a renewal link opens Paystack and payment extends the subscription", async () => {
  bot.store["subscribers/sub1"] = { customerName: "Mama Put", customerPhone: "08031234567", planId: "business_2", status: "active", paidUntil: lagosDate(-2) }
  bot.store["renewals/tok123"] = { collection: "subscribers", id: "sub1", customerPhone: "whatsapp:+2348031234567" }
  const res = await bot.runRoute("GET /renew/:token", { params: { token: "tok123" } })
  assert.equal(res.status, 303)
  const ref = res.location.split("/").pop()
  assert.equal(bot.store[`pendingPayments/${ref}`].amount, 10000)
  await webhook({ reference: ref, amount: 1000000 })
  const expected = new Date(`${lagosDate(0)}T00:00:00Z`)
  expected.setUTCMonth(expected.getUTCMonth() + 1)
  assert.equal(bot.store["subscribers/sub1"].paidUntil.slice(0, 7), expected.toISOString().slice(0, 7))
  assert.equal(bot.store["subscribers/sub1"].lastPaymentMethod, "paystack")
})
