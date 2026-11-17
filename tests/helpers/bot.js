// Starts server.js with Firestore, WhatsApp (Meta + Flaxxa), Paystack,
// Cloudinary, Next.js and Express replaced by in-memory fakes, so tests can
// hold real conversations with the bot. Call startBot() once per test file
// (each file runs in its own process).
const Module = require("module")
const path = require("path")

const lagosToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date())
const lagosDate = (offsetDays) => {
  const d = new Date(`${lagosToday()}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

function startBot({ seed = {}, env = {} } = {}) {
  Object.assign(process.env, {
    WAPI_TOKEN: "test-wapi",
    WHATSAPP_ACCESS_TOKEN: "test-meta",
    PUBLIC_BASE_URL: "https://bot.test",
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ client_email: "test@test", private_key: "key", project_id: "test" }),
    ...env,
  })

  // ── Fake Firestore ──────────────────────────────────────────────────────
  const store = {}
  let autoId = 0
  const docRef = (col, id = `auto${++autoId}`) => ({
    id,
    get: async () => ({ exists: !!store[`${col}/${id}`], id, data: () => store[`${col}/${id}`] }),
    set: async (d, o) => { store[`${col}/${id}`] = o?.merge ? { ...(store[`${col}/${id}`] || {}), ...d } : { ...d } },
    create: async (d) => {
      if (store[`${col}/${id}`]) { const e = new Error("exists"); e.code = 6; throw e }
      store[`${col}/${id}`] = { ...d }
    },
    update: async (d) => { store[`${col}/${id}`] = { ...store[`${col}/${id}`], ...d } },
    delete: async () => { delete store[`${col}/${id}`] },
  })
  const query = (col, filters = []) => ({
    where: (f, op, v) => query(col, [...filters, [f, op, v]]),
    limit() { return this },
    orderBy() { return this },
    get: async () => {
      const docs = Object.entries(store)
        .filter(([k, v]) => k.split("/")[0] === col && filters.every(([f, op, val]) =>
          op === "==" ? v[f] === val : op === "<" ? v[f] < val : op === ">" ? v[f] > val : op === "in" ? val.includes(v[f]) : true))
        .map(([k, v]) => ({ id: k.split("/")[1], data: () => v, ref: docRef(col, k.split("/")[1]) }))
      return { empty: !docs.length, size: docs.length, docs }
    },
  })
  const listeners = {}
  const db = {
    settings() {},
    listCollections: async () => [...new Set(Object.keys(store).map((k) => k.split("/")[0]))].map((id) => ({ id })),
    collection: (col) => ({
      ...query(col),
      doc: (id) => docRef(col, id),
      add: async (d) => { const r = docRef(col); await r.set(d); return r },
      onSnapshot(cb) { listeners[col] = cb; return () => {} },
    }),
    runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, d, o) => r.set(d, o), update: (r, d) => r.update(d) }),
    batch: () => {
      const ops = []
      return { delete: (r) => ops.push(() => r.delete()), commit: async () => { for (const op of ops) await op() } }
    },
  }

  // ── Fake WhatsApp / Paystack / Cloudinary / web ─────────────────────────
  const sent = [] // every outgoing message, as readable text
  const uploads = []
  const routes = {}
  const app = {
    use() {},
    listen: (port, cb) => cb && cb(),
    get(p, ...h) { routes[`GET ${p}`] = h },
    post(p, ...h) { routes[`POST ${p}`] = h },
    patch(p, ...h) { routes[`PATCH ${p}`] = h },
    delete(p, ...h) { routes[`DELETE ${p}`] = h },
  }
  const fakes = {
    "firebase-admin": {
      apps: [], initializeApp() {}, credential: { cert() {} }, firestore: () => db,
      auth: () => ({ verifyIdToken: async (t) => { if (!t?.startsWith("uid:")) throw new Error("bad token"); return { uid: t.slice(4) } } }),
    },
    cloudinary: { v2: {
      config() {},
      utils: { private_download_url: (id, f, o) => `https://api.cloudinary.test/download?public_id=${encodeURIComponent(id)}&type=${o.type}&expires_at=${o.expires_at}` },
      uploader: {
        upload_stream: (opts, cb) => ({ end: (buf) => { uploads.push({ opts, buf }); cb(null, { secure_url: `https://res.cloudinary.test/${opts.folder || ""}/${opts.public_id}` }) } }),
        destroy: async () => {},
      },
    } },
    next: () => ({ prepare: async () => {}, getRequestHandler: () => () => {} }),
    express: Object.assign(() => app, { static: () => () => {} }),
    "web-push": { generateVAPIDKeys: () => ({ publicKey: "P", privateKey: "K" }), setVapidDetails() {}, sendNotification: async () => {} },
    axios: {
      post: async (url, body) => {
        if (url.includes("graph.facebook")) {
          if (body.type === "template") sent.push(`[template ${body.template.name}]`)
          else if (body.type === "interactive") {
            const i = body.interactive
            const options = i.type === "button" ? i.action.buttons.map((b) => b.reply.title)
              : i.type === "list" ? i.action.sections[0].rows.map((r) => r.title)
              : [i.action.parameters.display_text]
            sent.push(`${i.body.text}\n[${options.join(" | ")}]`)
          } else sent.push(`[${body.type}${body.document?.filename ? ` ${body.document.filename}` : ""}]`)
          return { data: { messages: [{ id: "wamid" }] } }
        }
        if (url.includes("sendtemplatemessage")) return { data: { status: "error" } }
        if (url.includes("paystack")) return { data: { data: { authorization_url: `https://checkout.paystack.test/${body.reference}` } } }
        sent.push(body.message)
        return { data: {} }
      },
      get: async (url) => {
        if (url.includes("paystack")) return { data: { data: global.__paystackVerify || {} } }
        return { data: url.includes("graph.facebook") ? { url: "https://media.test" } : Buffer.from("image-bytes") }
      },
    },
  }
  const originalLoad = Module._load
  Module._load = function (request) { return fakes[request] ?? originalLoad.apply(this, arguments) }

  Object.assign(store, seed)
  // The bot logs every message; keep test output to the results. Set
  // BOT_LOGS=1 to see them while debugging a test.
  if (!process.env.BOT_LOGS) console.log = console.warn = console.error = () => {}
  require(path.join(__dirname, "..", "..", "server.js"))

  const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms))
  let messageNo = 0
  const deliver = async (phone, message) => {
    sent.length = 0
    runRoute("POST /whatsapp", { body: { entry: [{ changes: [{ value: { metadata: { phone_number_id: "PNID" }, messages: [{ from: phone, id: `msg${++messageNo}`, ...message }] } }] }] } })
    await wait()
    return sent.join("\n---\n")
  }
  // Runs a route's middleware chain like Express; resolves with { status, body }.
  async function runRoute(name, req = {}) {
    const result = { status: 200 }
    const res = {
      status(c) { result.status = c; return res }, json(b) { result.body = b; return res },
      sendStatus(c) { result.status = c; return res }, type() { return res }, send(b) { result.body = b; return res },
      redirect(c, u) { result.status = c; result.location = u; return res }, setHeader() {},
    }
    for (const handler of routes[name]) {
      let next = false
      await handler({ headers: {}, params: {}, query: {}, body: {}, ...req }, res, () => { next = true })
      if (!next) break
    }
    return result
  }
  // Feeds a Firestore change to the bot's listener (first call per collection = startup load).
  const started = new Set()
  async function change(col, id, type = "modified") {
    if (!started.has(col)) { started.add(col); listeners[col]?.({ docChanges: () => [] }) }
    listeners[col]({ docChanges: () => [{ type, doc: { id, data: () => ({ ...store[`${col}/${id}`] }), ref: docRef(col, id) } }] })
    await wait(100)
  }

  return {
    store, sent, uploads, routes, runRoute, change, wait,
    say: (phone, text) => deliver(phone, { type: "text", text: { body: text } }),
    tap: (phone, id, title = id) => deliver(phone, { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } }),
    photo: (phone, caption) => deliver(phone, { type: "image", image: { id: `img${messageNo}`, ...(caption ? { caption } : {}) } }),
    pin: (phone, latitude, longitude, name = "") => deliver(phone, { type: "location", location: { latitude, longitude, name } }),
    find: (col, fn) => Object.entries(store).filter(([k]) => k.startsWith(`${col}/`)).map(([, v]) => v).find(fn),
    all: (col) => Object.entries(store).filter(([k]) => k.startsWith(`${col}/`)).map(([, v]) => v),
  }
}

// Daily jobs that would otherwise run when the server starts.
function quietDailyJobs() {
  const today = lagosToday()
  return Object.fromEntries(["collectorSummary", "adminDigest", "autoRenewalReminders", "pickupReminders", "dailyBackup"]
    .map((id) => [`config/${id}`, { lastDate: today }]))
}

module.exports = { startBot, quietDailyJobs, lagosToday, lagosDate }
