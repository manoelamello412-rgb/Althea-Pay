const baseUrl = process.env.ALTHEA_HEALTH_URL || 'https://hkraryqoziravulvqkid.supabase.co/functions/v1/health'
const requests = Number(process.env.LOAD_REQUESTS || 500)
const concurrency = Number(process.env.LOAD_CONCURRENCY || 25)
if (!Number.isInteger(requests) || requests < 1 || requests > 5000) throw new Error('LOAD_REQUESTS must be 1..5000')
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) throw new Error('LOAD_CONCURRENCY must be 1..100')
let next = 0
let ok = 0
const latencies = []
const errors = []
async function worker() {
  while (true) {
    const i = next++
    if (i >= requests) return
    const started = performance.now()
    try {
      const response = await fetch(baseUrl, { headers: { accept: 'application/json' } })
      const body = await response.text()
      latencies.push(performance.now() - started)
      if (response.status === 200 && body.includes('"ok":true')) ok++
      else errors.push(`request=${i} status=${response.status} body=${body.slice(0,160)}`)
    } catch (error) {
      errors.push(`request=${i} error=${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
const started = performance.now()
await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, worker))
latencies.sort((a, b) => a - b)
const percentile = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] ?? Infinity
const total = performance.now() - started
const successRate = ok / requests
const p95 = percentile(0.95)
const p99 = percentile(0.99)
console.log(JSON.stringify({ target: baseUrl, requests, concurrency, ok, errors: errors.length, successRate, totalMs: Math.round(total), p95Ms: Math.round(p95), p99Ms: Math.round(p99) }, null, 2))
if (errors.length || successRate < 0.99 || p95 > 2000 || p99 > 5000) {
  console.error(errors.slice(0, 10).join('\n'))
  process.exit(1)
}
