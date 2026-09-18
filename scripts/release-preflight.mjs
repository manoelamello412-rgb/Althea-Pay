import { readdir, readFile, access } from "node:fs/promises"
import { dirname, join, normalize, relative, sep } from "node:path"
const root=process.cwd(),failures=[],checked=[]
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){if(["node_modules",".git",".next"].includes(entry.name))continue;const path=join(dir,entry.name);if(entry.isDirectory())await walk(path);else if(/\.(ts|tsx|js|mjs|sql|toml|json)$/.test(entry.name))checked.push(path)}}
await walk(root)
const source=new Map();for(const file of checked)source.set(file,await readFile(file,"utf8"))
function assertNo(pattern,label,files=checked){for(const file of files)if(pattern.test(source.get(file)))failures.push(`${label}: ${relative(root,file)}`)}
const browserFiles=checked.filter(file=>/(^|[\\/])app[\\/]|(^|[\\/])components[\\/]/.test(file));assertNo(/SUPABASE_SERVICE_ROLE_KEY|service_role/i,"Service-role secret referenced by browser/UI code",browserFiles)
const cardDataProductionFiles=checked.filter(file=>!file.includes(`${sep}tests${sep}`)&&!file.endsWith(join("scripts","release-preflight.mjs"))&&!file.includes(`${sep}supabase${sep}migrations${sep}`));assertNo(/\b(?:card_number|cardNumber|pan|cvc|cvv|security_code|securityCode)\b\s*[:=]/i,"Raw card credential field assignment detected",cardDataProductionFiles)
const functionFiles=checked.filter(file=>file.includes(`${sep}supabase${sep}functions${sep}`));assertNo(/from\(['"]webhook_integrations['"]\)\.select\([^)]*\bsecret\b/i,"Plaintext webhook secret selected directly from webhook_integrations",functionFiles)
for(const file of functionFiles){const text=source.get(file);if(/\bsetTimeout\s*\(/.test(text)&&!/\bclearTimeout\s*\(/.test(text))failures.push(`Timer without clearTimeout cleanup: ${relative(root,file)}`)}
const paymentFiles=functionFiles.filter(file=>/gateway|checkout|refund|payment|reconciliation|risk-engine|event-worker|automation-engine/.test(file));assertNo(/(^|[=({,:;\s])void\s+fetch\s*\(/,"Fire-and-forget fetch in payment-critical code",paymentFiles);assertNo(/(^|[=({,:;\s])fetch\s*\([^;\n]+\)\s*;\s*(?:return|})/s,"Potential unawaited fetch in payment-critical code",paymentFiles)
const protectedFunctions=["event-worker","automation-engine-v2","reconciliation-worker","risk-engine","core-worker","integration-event-processor","gateway-webhook-processor","crm-channel-outbox-dispatcher","crm-channel-delivery-webhook","iara-commercial-intervention-worker","iara-daily-report-worker"]
for(const name of protectedFunctions){const file=join(root,"supabase","functions",name,"index.ts");try{const text=await readFile(file,"utf8");if(!text.includes("ALTHEA_INTERNAL_SECRET")&&!text.includes("x-internal-secret"))failures.push(`Internal function missing explicit internal-secret guard: ${name}`)}catch{failures.push(`Required internal function missing: ${name}`)}}
const crmFiles=["supabase/functions/crm-channel-outbox-dispatcher/index.ts","supabase/functions/crm-channel-inbound-webhook/index.ts","supabase/functions/crm-channel-delivery-webhook/index.ts","supabase/functions/crm-channel-twilio-inbound/index.ts","supabase/functions/crm-predictive-outcome-worker/index.ts","supabase/functions/automation-retry-worker/index.ts","app/api/crm/ai-agent/execute/route.ts","app/api/crm/observability/route.ts"]
for(const file of crmFiles){if(!source.has(join(root,file)))failures.push(`Required Multi-CRM component missing: ${file}`)}
assertNo(/SUPABASE_SERVICE_ROLE_KEY/i,"Service-role secret referenced by CRM browser/API surface",checked.filter(file=>/(^|[\\/])app[\\/]dashboard[\\/]crm[\\/]|(^|[\\/])components[\\/]crm[\\/]/.test(file)))
const requiredFiles=["supabase/functions/gateway-orchestrator/index.ts","supabase/functions/gateway-provider-adapter/index.ts","supabase/functions/gateway-connection-test/index.ts","supabase/functions/checkout-engine-v2/index.ts","supabase/functions/gateway-webhook/index.ts","supabase/functions/gateway-webhook-processor/index.ts","supabase/functions/althea-public-api/index.ts","supabase/functions/althea-webhook/index.ts","supabase/functions/health/index.ts","supabase/functions/iara-ai-core/index.ts","supabase/functions/iara-copilot/index.ts","supabase/functions/iara-funnel-builder/index.ts","supabase/functions/iara-funnel-activate/index.ts","supabase/functions/iara-commercial-intervention/index.ts","supabase/functions/iara-commercial-intervention-worker/index.ts","supabase/functions/iara-daily-report/index.ts","supabase/functions/iara-daily-report-worker/index.ts","supabase/functions/iara-financial-confirm/index.ts","supabase/functions/iara-financial-command/index.ts","scripts/load-smoke.mjs"]
for(const file of requiredFiles)if(!source.has(join(root,file)))failures.push(`Required release component missing: ${file}`)
const retiredFunctions=["api","integration-webhook","checkout-engine","automation-engine","althea-gateway-orchestrator","gateway-refund","gateway-refund-v2","gateway-payment-link","gateway-provider-adapter-v2","funnel-events-secure"]
for(const name of retiredFunctions)if(source.has(join(root,"supabase","functions",name,"index.ts")))failures.push(`Retired duplicate function still present: ${name}`)
const operationalCode=checked.filter(file=>!file.includes(`${sep}supabase${sep}migrations${sep}`)&&!file.endsWith(join("scripts","release-preflight.mjs")))
assertNo(/rank_gateway_candidates/,"Retired gateway ranking RPC still referenced",operationalCode)
assertNo(/dynamic-gateway-connector-v[23]/,"Versioned gateway connector still referenced",operationalCode)
assertNo(/althea-mobile-page/,"Legacy event-based navigation still referenced",operationalCode)
const duplicateRoutes=[
  "app/dashboard/settings/usuarios/page.tsx",
  "app/dashboard/settings/gateways/page.tsx",
  "app/dashboard/settings/vendas/page.tsx",
  "app/dashboard/settings/seguranca/page.tsx",
  "app/dashboard/settings/integracoes/page.tsx",
  "app/dashboard/crm/mobile/page.tsx",
]
for(const file of duplicateRoutes)if(source.has(join(root,file)))failures.push(`Duplicate route surface still present: ${file}`)
try{await access(join(root,"docs","PRODUCTION_READINESS.md"))}catch{failures.push("Production readiness document missing")}
const tsFiles=checked.filter(file=>/\.(ts|tsx)$/.test(file))
const incoming=new Map(tsFiles.map(file=>[normalize(file),[]]))
for(const file of tsFiles){
  const text=source.get(file)
  const specs=[...text.matchAll(/(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g)].map(match=>match[1])
  for(const spec of specs){
    let base=null
    if(spec.startsWith("@/"))base=join(root,spec.slice(2))
    else if(spec.startsWith("."))base=join(dirname(file),spec)
    if(!base)continue
    const candidates=[base,base+".ts",base+".tsx",join(base,"index.ts"),join(base,"index.tsx")].map(normalize)
    const target=candidates.find(candidate=>incoming.has(candidate))
    if(target)incoming.get(target).push(file)
  }
}
const orphanComponents=[...incoming.entries()]
  .filter(([file,refs])=>file.includes(`${sep}components${sep}`)&&refs.length===0)
  .map(([file])=>relative(root,file))
  .sort()
console.log(`Release preflight: unreferenced component candidates (${orphanComponents.length}): ${orphanComponents.join(", ")||"none"}`)
const orphanLib=[...incoming.entries()]
  .filter(([file,refs])=>file.includes(`${sep}lib${sep}`)&&refs.length===0)
  .map(([file])=>relative(root,file))
  .sort()
console.log(`Release preflight: unreferenced lib candidates (${orphanLib.length}): ${orphanLib.join(", ")||"none"}`)
console.log(`Release preflight: checked ${checked.length} source/config files.`)
if(failures.length){console.error("Release preflight FAILED:");for(const failure of failures)console.error(`- ${failure}`);process.exit(1)}
console.log("Release preflight PASSED: canonical release components, browser secrets, raw-card assignments, webhook Vault access, timer cleanup, async payment calls, internal guards, CRM/Iara components and retired duplicate, legacy navigation and duplicate-route checks are clear.")
