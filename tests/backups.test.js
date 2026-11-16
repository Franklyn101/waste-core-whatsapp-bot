// Nightly backups: only the main admin, every collection saved privately,
// timestamps kept, and the restore script reads the file back.
const test = require("node:test")
const assert = require("node:assert/strict")
const zlib = require("zlib")
const { startBot, quietDailyJobs } = require("./helpers/bot")

const bot = startBot({
  seed: {
    ...quietDailyJobs(),
    "admins/boss": { role: "main", active: true, username: "boss" },
    "admins/staff": { role: "sub", active: true, username: "staff" },
    "customers/2348000000001": { name: "Ada" },
    "subscribers/s1": { customerName: "Shop", planId: "business_1", signedAt: { toDate: () => new Date("2026-01-02T03:04:05Z") } },
    "processedMessages/m1": { processedAt: "x" },
  },
})
const as = (uid) => ({ headers: { authorization: `Bearer uid:${uid}` } })

test("only the main admin can back up", async () => {
  assert.equal((await bot.runRoute("POST /api/backups", as("staff"))).status, 403)
  assert.equal((await bot.runRoute("POST /api/backups", {})).status, 401)
})

test("a backup saves every collection as a private file", async () => {
  const res = await bot.runRoute("POST /api/backups", as("boss"))
  assert.equal(res.status, 200)
  assert.ok(res.body.docs > 0)
  const upload = bot.uploads.find((u) => u.opts.resource_type === "raw")
  assert.equal(upload.opts.type, "private")
  const file = JSON.parse(zlib.gunzipSync(upload.buf))
  assert.equal(file.app, "WasteCore")
  assert.ok(file.collections.customers && file.collections.subscribers)
  assert.ok(!file.collections.processedMessages, "duplicate markers are skipped")
  assert.deepEqual(file.collections.subscribers.s1.signedAt, { __timestamp: "2026-01-02T03:04:05.000Z" })
})

test("the list hides storage paths and downloads use a short-lived link", async () => {
  const list = await bot.runRoute("GET /api/backups", as("boss"))
  assert.equal(list.body.backups[0].status, "ok")
  assert.ok(!("publicId" in list.body.backups[0]))
  const link = await bot.runRoute("POST /api/backups/:date/link", { ...as("boss"), params: { date: list.body.backups[0].date } })
  assert.match(link.body.url, /type=private&expires_at=\d+/)
})
