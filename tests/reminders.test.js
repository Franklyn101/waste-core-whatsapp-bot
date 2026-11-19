// Pickup reminders: automatic the day before with the admin's message,
// skipping customers already reminded, and "Send reminder" from the dashboard.
const test = require("node:test")
const assert = require("node:assert/strict")

// Fixed clock: 18:00 in Lagos (17:00 UTC) today, so the 5pm run is due.
const RealDate = Date
const lagosNow = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new RealDate())
const FIXED = RealDate.parse(`${lagosNow}T17:00:00Z`)
const START = RealDate.now()
global.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(FIXED + (RealDate.now() - START)) }
  static now() { return FIXED + (RealDate.now() - START) }
}

const { startBot, lagosToday, lagosDate } = require("./helpers/bot")
const tomorrow = lagosDate(1)
const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${tomorrow}T00:00:00Z`).getUTCDay()]
const TIP = "Please tie your bags and put them outside the gate by 8am."
const seed = {
  "config/whatsapp": { phoneNumberId: "PNID" },
  "settings/pickupReminders": { enabled: true, hour: 17, tip: TIP },
  "pickupRequests/sched": { customerName: "Ada", customerPhone: "whatsapp:+2348500000001", address: "1 Mbiama Road", pickupDate: tomorrow, timeWindow: "Morning (8am-12pm)", status: "assigned", notifiedStatus: "assigned" },
  "pickupRequests/done": { customerName: "Already", customerPhone: "whatsapp:+2348500000002", pickupDate: tomorrow, status: "pending", notifiedStatus: "pending", customerReminder: { status: "template", date: tomorrow } },
  "pickupRequests/cancelled": { customerName: "Cancelled", customerPhone: "whatsapp:+2348500000003", pickupDate: tomorrow, status: "cancelled", notifiedStatus: "cancelled" },
  "subscribers/sub": { customerName: "Mama Put", customerPhone: "0805 000 0004", address: "12 Okaka Road", planId: "business_2", pickupDays: [weekday], timeWindow: "afternoon", status: "active" },
  "subscribers/other": { customerName: "Other day", customerPhone: "08050000005", planId: "household_1", pickupDays: [], status: "active" },
}
for (const id of ["collectorSummary", "adminDigest", "autoRenewalReminders", "dailyBackup"]) seed[`config/${id}`] = { lastDate: lagosToday() }
const bot = startBot({ seed })

test("the automatic run reminds tomorrow's customers with the admin's message", async () => {
  await bot.wait(300)
  const reminders = bot.templates.filter((t) => t.name === "pickup_reminder_tip")
  assert.deepEqual(reminders.map((t) => t.to).sort(), ["2348050000004", "2348500000001"])
  const ada = reminders.find((t) => t.to === "2348500000001")
  assert.equal(ada.params[0], "Ada")
  assert.match(ada.params[1], /^tomorrow, .*Morning/)
  assert.equal(ada.params[2], "1 Mbiama Road")
  assert.equal(ada.params[3], TIP)
  assert.equal(bot.store["pickupRequests/sched"].customerReminder.auto, true)
  assert.equal(bot.store["subscribers/sub"].lastReminder.date, tomorrow)
})

test("customers already reminded, cancelled pickups and other days are skipped", () => {
  const sentTo = bot.templates.map((t) => t.to)
  for (const phone of ["2348500000002", "2348500000003", "2348050000005"]) assert.ok(!sentTo.includes(phone), phone)
})

test("'Send reminder' on the dashboard sends one for any day", async () => {
  bot.store["instantPickups/today"] = { customerName: "Efe", customerPhone: "whatsapp:+2348500000006", address: "Swali", pickupDate: lagosToday(), status: "assigned", notifiedStatus: "assigned" }
  await bot.change("instantPickups", "today", "added")
  bot.templates.length = 0
  bot.store["instantPickups/today"].reminderRequestedAt = new Date().toISOString()
  await bot.change("instantPickups", "today")
  assert.equal(bot.templates.length, 1)
  assert.match(bot.templates[0].params[1], /^today, /)
  assert.equal(bot.store["instantPickups/today"].customerReminder.status, "template")
  await bot.change("instantPickups", "today")
  assert.equal(bot.templates.length, 1, "not sent twice for the same request")
})

test("a subscriber's visit can be reminded from the dashboard", async () => {
  bot.templates.length = 0
  bot.store["subscribers/other"].reminderRequest = { date: lagosDate(3), requestedAt: new Date().toISOString() }
  await bot.change("subscribers", "other")
  assert.equal(bot.templates.length, 1)
  assert.equal(bot.store["subscribers/other"].lastReminder.date, lagosDate(3))
})
