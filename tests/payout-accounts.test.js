// Collector payout accounts: bank list and the account-name check
// (both through Paystack, signed-in admins only).
const test = require("node:test")
const assert = require("node:assert/strict")
const { startBot, quietDailyJobs } = require("./helpers/bot")

const bot = startBot({
  env: { PAYSTACK_SECRET_KEY: "sk_test_ci" },
  seed: { ...quietDailyJobs(), "admins/boss": { role: "main", active: true, username: "boss" } },
})
const asAdmin = { headers: { authorization: "Bearer uid:boss" } }

test("only signed-in admins can use the bank endpoints", async () => {
  assert.equal((await bot.runRoute("GET /api/banks", {})).status, 401)
  assert.equal((await bot.runRoute("POST /api/collectors/resolve-account", { body: { bankCode: "058", accountNumber: "0123456789" } })).status, 401)
})

test("the bank list is sorted and leaves out closed banks", async () => {
  const res = await bot.runRoute("GET /api/banks", asAdmin)
  assert.deepEqual(res.body.banks, [{ name: "Access Bank", code: "044" }, { name: "Guaranty Trust Bank", code: "058" }])
})

test("a real account returns the name the bank holds", async () => {
  const res = await bot.runRoute("POST /api/collectors/resolve-account", { ...asAdmin, body: { bankCode: "058", accountNumber: "012 345 6789" } })
  assert.equal(res.status, 200)
  assert.equal(res.body.accountName, "TUNDE BAKARE")
})

test("wrong numbers are refused with a clear message", async () => {
  const short = await bot.runRoute("POST /api/collectors/resolve-account", { ...asAdmin, body: { bankCode: "058", accountNumber: "12345" } })
  assert.equal(short.status, 400)
  const unknown = await bot.runRoute("POST /api/collectors/resolve-account", { ...asAdmin, body: { bankCode: "044", accountNumber: "0123456789" } })
  assert.equal(unknown.status, 404)
  assert.match(unknown.body.error, /Account not found/)
})
