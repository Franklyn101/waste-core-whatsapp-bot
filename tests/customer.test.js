// Customer conversations: menu, booking with a bank-transfer receipt,
// address pins, dates, cancelling, and My Bookings.
const test = require("node:test")
const assert = require("node:assert/strict")
const { startBot, quietDailyJobs, lagosDate } = require("./helpers/bot")

const bot = startBot({ seed: { ...quietDailyJobs() } })

test("any greeting opens the tap menu", async () => {
  const reply = await bot.say("2348100000001", "Good morning")
  assert.match(reply, /Welcome to WasteCore/)
  assert.match(reply, /Instant Pickup \| Schedule a Pickup .*My Bookings/)
})

test("cancel words reset the conversation, an address with 'stop' does not", async () => {
  assert.match(await bot.say("2348100000001", "cancel please"), /Cancelled/)
  await bot.say("2348100000002", "hi")
  await bot.say("2348100000002", "2")
  await bot.say("2348100000002", "Bisi")
  assert.match(await bot.say("2348100000002", "Ojota bus stop"), /How many bags/)
})

test("scheduled pickup with a bank-transfer receipt is saved", async () => {
  const phone = "2348100000003"
  await bot.say(phone, "hi")
  assert.match(await bot.say(phone, "2"), /full name/)
  assert.match(await bot.say(phone, "Ada Obi"), /pickup address/)
  assert.match(await bot.say(phone, "12 Okaka Road"), /How many bags/)
  assert.match(await bot.say(phone, "2-3"), /number of bags/, "a range is refused")
  assert.match(await bot.say(phone, "3"), /3 bags × ₦650 = \*₦1,950\*/)
  assert.match(await bot.say(phone, "01/01/2020"), /That date has passed/)
  assert.match(await bot.tap(phone, "tomorrow", "Tomorrow"), /Preferred pickup time/)
  assert.match(await bot.say(phone, "1"), /Pay by bank transfer/)
  assert.match(await bot.photo(phone), /Receipt received/)
  const booking = bot.find("pickupRequests", (b) => b.customerName === "Ada Obi")
  assert.ok(booking, "booking saved")
  assert.equal(booking.totalAmount, 1950)
  assert.equal(booking.pickupDate, lagosDate(1))
  assert.equal(booking.paymentStatus, "unverified")
  assert.ok(booking.paymentReceiptUrl)
})

test("a returning customer is greeted by name and can reuse their address", async () => {
  const phone = "2348100000003"
  bot.store["pickupRequests/done"] = { customerPhone: `whatsapp:+${phone}`, status: "completed" }
  for (const [k, v] of Object.entries(bot.store)) if (k.startsWith("pickupRequests/") && v.customerName === "Ada Obi") v.status = "completed"
  assert.match(await bot.say(phone, "hello"), /Welcome back, Ada Obi/)
  assert.match(await bot.say(phone, "2"), /Use last address/)
  assert.match(await bot.tap(phone, "1", "Use last address"), /How many bags/)
  await bot.say(phone, "cancel")
})

test("a location pin is kept and a landmark is asked for", async () => {
  const phone = "2348100000004"
  await bot.say(phone, "hi")
  await bot.say(phone, "2")
  await bot.say(phone, "Chidi")
  assert.match(await bot.pin(phone, 4.9247, 6.2676, "Okaka Estate"), /Got your location pin/)
  assert.match(await bot.say(phone, "opposite First Bank"), /How many bags/)
  assert.match(await bot.pin("2348100000005", 4.8, 7.0), /./) // not in an address step: no crash
  await bot.say(phone, "cancel")
})

test("a pin far outside Yenagoa is flagged", async () => {
  const phone = "2348100000006"
  await bot.say(phone, "hi")
  await bot.say(phone, "2")
  await bot.say(phone, "Dayo")
  assert.match(await bot.pin(phone, 4.8156, 7.0498, "Port Harcourt"), /outside our current service area/)
  await bot.say(phone, "cancel")
})

test("My Bookings lists a pickup and cancels it", async () => {
  const phone = "2348100000007"
  bot.store["pickupRequests/mine"] = {
    customerName: "Efe", customerPhone: `whatsapp:+${phone}`, address: "5 Edepie", pickupDate: lagosDate(2),
    serviceType: "scheduled", status: "pending", createdAt: new Date().toISOString(),
  }
  assert.match(await bot.say(phone, "hi"), /booking in progress/)
  assert.match(await bot.tap(phone, "2", "My bookings"), /Your bookings/)
  assert.match(await bot.tap(phone, "1"), /Change date \| Cancel booking \| Back/)
  assert.match(await bot.tap(phone, "2", "Cancel booking"), /Are you sure/)
  assert.match(await bot.tap(phone, "yes", "Yes, cancel it"), /has been cancelled/)
  assert.equal(bot.store["pickupRequests/mine"].status, "cancelled")
  assert.equal(bot.store["pickupRequests/mine"].cancelledBy, "customer")
})
