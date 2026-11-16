// Collectors: they never get the customer menu; reports, proof photos,
// failures, and messages when a job is assigned to them.
const test = require("node:test")
const assert = require("node:assert/strict")
const { startBot, quietDailyJobs, lagosToday } = require("./helpers/bot")

const today = lagosToday()
const job = (name, collectorId = "tunde") => ({
  customerName: name, customerPhone: "whatsapp:+2348300000009", address: `${name} Street`,
  pickupDate: today, status: "assigned", notifiedStatus: "assigned", collectorId,
})
const bot = startBot({
  seed: {
    ...quietDailyJobs(),
    "config/whatsapp": { phoneNumberId: "PNID" },
    "collectors/tunde": { name: "Tunde", phone: "0803 555 0001", active: true },
    "collectors/ngozi": { name: "Ngozi", phone: "+234 803 555 0002", active: true },
    "pickupRequests/bola": job("Bola"),
    "pickupRequests/chidi": job("Chidi"),
    "instantPickups/ada": job("Ada", "ngozi"),
  },
})
const TUNDE = "2348035550001"
const NGOZI = "2348035550002"

test("a collector saying hi gets their jobs, not the customer menu", async () => {
  const reply = await bot.say(TUNDE, "hi")
  assert.match(reply, /registered as a WasteCore collector/)
  assert.match(reply, /Bola/)
  assert.doesNotMatch(reply, /What would you like to do/)
})

test("a photo from a collector with one job reports it done with proof", async () => {
  assert.match(await bot.photo(NGOZI), /reported as done, with your photo/)
  const report = bot.store["instantPickups/ada"].collectorReport
  assert.equal(report.status, "done")
  assert.match(report.photoUrl, /pickup-proof/)
  assert.equal(bot.store["instantPickups/ada"].status, "assigned", "the admin still confirms")
})

test("'job done' with two jobs asks which, then takes the number and a photo", async () => {
  assert.match(await bot.say(TUNDE, "Job done"), /Which job is done/)
  assert.match(await bot.say(TUNDE, "2"), /Job 2 \(Chidi\) is reported as done/)
  assert.match(await bot.photo(TUNDE), /Photo saved/)
  assert.ok(bot.store["pickupRequests/chidi"].collectorReport.photoUrl)
})

test("a photo captioned 'done 1' reports in one step", async () => {
  assert.match(await bot.photo(TUNDE, "done 1"), /Job 1 \(Bola\) is reported as done, with your photo/)
})

test("'couldn't pick up' records a failure with the reason", async () => {
  bot.store["pickupRequests/dayo"] = job("Dayo")
  assert.match(await bot.say(TUNDE, "Couldn't pick up, nobody home"), /couldn't be picked up/)
  assert.equal(bot.store["pickupRequests/dayo"].collectorReport.status, "failed")
  assert.match(bot.store["pickupRequests/dayo"].collectorReport.reason, /nobody home/)
})

test("BOOK gives a collector the customer menu", async () => {
  assert.match(await bot.say(TUNDE, "book"), /What would you like to do/)
  assert.match(await bot.say(TUNDE, "2"), /full name/)
  await bot.say(TUNDE, "cancel")
})

test("a customer typing 'done' still gets the customer menu", async () => {
  assert.match(await bot.say("2348399999999", "done"), /What would you like to do/)
})

test("assigning a job messages the collector once", async () => {
  bot.store["pickupRequests/new"] = { ...job("Efe"), status: "pending", notifiedStatus: "pending", collectorId: null }
  await bot.change("pickupRequests", "new")
  Object.assign(bot.store["pickupRequests/new"], { collectorId: "ngozi", collectorName: "Ngozi", status: "assigned", collectorAssignedAt: new Date().toISOString() })
  bot.sent.length = 0
  await bot.change("pickupRequests", "new")
  assert.ok(bot.sent.includes("[template collector_new_pickup]"))
  bot.sent.length = 0
  await bot.change("pickupRequests", "new")
  assert.ok(!bot.sent.includes("[template collector_new_pickup]"), "not sent twice")
})
