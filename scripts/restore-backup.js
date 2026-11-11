#!/usr/bin/env node
// Restores a WasteCore backup (backup-YYYY-MM-DD.json.gz, downloaded from the
// dashboard's Backups page) into Firestore.
//
//   node scripts/restore-backup.js <backup file> [--only col1,col2] [--yes]
//
// Without --yes it only shows what it would write. Documents in the backup
// overwrite documents with the same id; nothing else is deleted. Uses the
// same Firebase credentials as the bot (FIREBASE_SERVICE_ACCOUNT, or
// FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY).
require("dotenv").config()
const fs = require("fs")
const zlib = require("zlib")
const admin = require("firebase-admin")

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith("--"))
const write = args.includes("--yes")
const onlyArg = args.find((a) => a.startsWith("--only"))
const only = onlyArg ? (onlyArg.split("=")[1] ?? args[args.indexOf(onlyArg) + 1] ?? "").split(",").filter(Boolean) : null

if (!file) {
  console.error("Usage: node scripts/restore-backup.js <backup-YYYY-MM-DD.json.gz> [--only col1,col2] [--yes]")
  process.exit(1)
}

function credentials() {
  const env = process.env
  if (env.FIREBASE_SERVICE_ACCOUNT) return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    return {
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }
  }
  throw new Error("Set FIREBASE_SERVICE_ACCOUNT (or the three FIREBASE_* variables) first.")
}

// Turns the backup's { __timestamp: ISO } tags back into Firestore timestamps.
function restoreValue(value) {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(restoreValue)
  if (Object.keys(value).length === 1 && typeof value.__timestamp === "string") {
    return admin.firestore.Timestamp.fromDate(new Date(value.__timestamp))
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restoreValue(v)]))
}

async function main() {
  const raw = fs.readFileSync(file)
  const json = JSON.parse((file.endsWith(".gz") ? zlib.gunzipSync(raw) : raw).toString("utf8"))
  if (json.app !== "WasteCore" || !json.collections) throw new Error("This doesn't look like a WasteCore backup.")
  const names = Object.keys(json.collections).filter((n) => !only || only.includes(n))
  console.log(`Backup from ${json.createdAt}`)
  for (const n of names) console.log(`  ${n}: ${Object.keys(json.collections[n]).length} documents`)
  if (!write) {
    console.log("\nNothing written. Run again with --yes to restore these into Firestore.")
    return
  }
  admin.initializeApp({ credential: admin.credential.cert(credentials()) })
  const db = admin.firestore()
  let total = 0
  for (const n of names) {
    const entries = Object.entries(json.collections[n])
    for (let i = 0; i < entries.length; i += 400) {
      const batch = db.batch()
      for (const [id, data] of entries.slice(i, i + 400)) batch.set(db.collection(n).doc(id), restoreValue(data))
      await batch.commit()
    }
    total += entries.length
    console.log(`Restored ${n} (${entries.length})`)
  }
  console.log(`Done: ${total} documents restored.`)
}

main().catch((err) => {
  console.error("Restore failed:", err.message)
  process.exit(1)
})
