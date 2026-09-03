import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"

const root = process.cwd()
const failures = []
const checked = []

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (["node_modules", ".git", ".next"].includes(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await walk(path)
    else if (/\.(ts|tsx|js|mjs|sql|toml|json)$/.test(entry.name)) checked.push(path)
  }
}

await walk(root)

const source = new Map()
for (const file of checked) {
  source.set(file, await readFile(file, "utf8"))
}

function assertNo(pattern, label, files = checked) {
  for (const file of files) {
    if (pattern.test(source.get(file))) {
      failures.push(`${label}: ${relative(root, file)}`)
    }
  }
}

const browserFiles = checked.filter((file) => /(^|[\\/])app[\\/]|(^|[\\/])components[\\/]/.test(file))
assertNo(/SUPABASE_SERVICE_ROLE_KEY|service_role/i, "Service-role secret referenced by browser/UI code", browserFiles)
assertNo(/(?:card_number|pan|cvc|cvv|security_code)\s*[:=]/i, "Raw card credential field detected in application source", checked.filter((file) => !file.includes("test")))

const protectedFunctions = [
  "event-worker",
  "automation-engine-v2",
  "reconciliation-worker",
  "risk-engine",
  "core-worker",
]

for (const name of protectedFunctions) {
  const file = join(root, "supabase", "functions", name, "index.ts")
  try {
    const text = await readFile(file, "utf8")
    if (!text.includes("ALTHEA_INTERNAL_SECRET") && !text.includes("x-internal-secret")) {
      failures.push(`Internal function missing explicit internal-secret guard: ${name}`)
    }
  } catch {
    failures.push(`Required internal function missing: ${name}`)
  }
}

const requiredFiles = [
  "supabase/functions/gateway-orchestrator/index.ts",
  "supabase/functions/checkout-engine-v2/index.ts",
  "supabase/functions/gateway-webhook/index.ts",
  "supabase/functions/althea-public-api/index.ts",
  "supabase/functions/althea-webhook/index.ts",
  "supabase/functions/health/index.ts",
  "scripts/load-smoke.mjs",
]

for (const file of requiredFiles) {
  if (!source.has(join(root, file))) failures.push(`Required release component missing: ${file}`)
}

const readinessDoc = join(root, "docs", "PRODUCTION_READINESS.md")
if (!source.has(readinessDoc)) failures.push("Production readiness document missing")

console.log(`Release preflight: checked ${checked.length} source/config files.`)

if (failures.length) {
  console.error("Release preflight FAILED:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log("Release preflight PASSED: no browser service-role exposure, no raw card credential fields, required internal guards and core components present.")
