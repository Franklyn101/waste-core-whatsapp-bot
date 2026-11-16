#!/usr/bin/env node
// Fails if the TypeScript error count goes above the known baseline.
// The dashboard has older type errors (the build ignores them); this stops
// new ones being added. When errors are fixed, lower the number in
// .tsc-baseline so they can't come back.
const { spawnSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const baselineFile = path.join(__dirname, "..", ".tsc-baseline")
const baseline = Number(fs.readFileSync(baselineFile, "utf8").trim())
const result = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "--noEmit", "-p", "."], {
  cwd: path.join(__dirname, ".."),
  encoding: "utf8",
})
const output = `${result.stdout}${result.stderr}`
const errors = output.split("\n").filter((line) => /error TS\d+/.test(line))

console.log(`TypeScript errors: ${errors.length} (baseline ${baseline})`)
if (errors.length > baseline) {
  console.error(`\n${errors.length - baseline} new type error(s). All current errors:\n`)
  console.error(errors.join("\n"))
  process.exit(1)
}
if (errors.length < baseline) {
  console.log(`Fewer errors than the baseline. Update .tsc-baseline to ${errors.length} to lock that in.`)
}
