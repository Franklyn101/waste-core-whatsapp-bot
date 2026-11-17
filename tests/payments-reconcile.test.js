// A payment Paystack confirms but whose webhook never arrived (and the
// customer never returned to the page) is still booked by the safety net.
const test = require("node:test")
const assert = require("node:assert/strict")
const { startBot, quietDailyJobs } = require("./helpers/bot")

const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString()
const pending = (createdAt, extra = {}) => ({
  collection: "instantPickups", amount: 2000, confirmation: "Booked!", customerPhone: "whatsapp:+2348400000001", status: "pending", createdAt,
  doc: { customerName: "Missed Webhook", customerPhone: "whatsapp:+2348400000001", serviceType: "instant", pickupDate: "2099-01-01", totalAmount: 2000 },
  ...extra,
})

// Paystack says the payment succeeded.
global.__paystackVerify = { status: "success", currency: "NGN", amount: 200000, channel: "card" }
const bot = startBot({
  env: { PAYSTACK_SECRET_KEY: "sk_test_ci" },
  seed: {
    ...quietDailyJobs(),
    "pendingPayments/WC-PAID-LATE": pending(minutesAgo(20)),
    "pendingPayments/WC-TOO-NEW": pending(minutesAgo(1)),
    "pendingPayments/WC-CHECKED": pending(minutesAgo(40), { lastCheckedAt: minutesAgo(10) }),
  },
})

test("a paid link with no webhook is booked within minutes", async () => {
  await bot.wait(300)
  const booking = bot.find("instantPickups", (b) => b.paymentReference === "WC-PAID-LATE")
  assert.ok(booking, "booking created by reconciliation")
  assert.equal(booking.paymentMethod, "paystack")
  assert.equal(bot.store["pendingPayments/WC-PAID-LATE"].status, "paid")
})

test("very new links and recently checked links are left alone", async () => {
  assert.equal(bot.store["pendingPayments/WC-TOO-NEW"].status, "pending")
  assert.equal(bot.store["pendingPayments/WC-CHECKED"].status, "pending")
  assert.equal(bot.all("instantPickups").length, 1)
})
