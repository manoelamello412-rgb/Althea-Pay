import handler from '../gateway-sandbox'
import { IdempotencyStore } from '../../../lib/idempotency'

const store = new IdempotencyStore()

// Orchestrator: receives a payment request and routes to the appropriate gateway.
// For now, default gateway is sandbox. Supports basic fallback: if primary returns error, try sandbox.
export default async function handlerOrchestrator(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const body = req.body || {}
  const idempotencyKey = req.headers['idempotency-key'] || req.headers['Idempotency-Key']

  // Idempotency guard
  if (idempotencyKey) {
    const existing = await store.get(idempotencyKey)
    if (existing) return res.status(200).json({ duplicate: true, result: existing })
  }

  // route: for now we only have sandbox. Keep interface to add real gateway adapters.
  try {
    // call sandbox handler directly to avoid external HTTP in tests
    // build a fake req/res for the sandbox handler
    const sandboxReq = { method: 'POST', headers: req.headers, body }
    const sandboxRes = createFakeRes()
    await handler(sandboxReq, sandboxRes)
    const sandboxJson = sandboxRes._json

    if (sandboxJson?.result?.status === 'error') {
      // fallback logic could call trailing gateways — for now respond with error
      // If there was a configured primary that failed, here we could try fallback.
      const fallbackAttempt = sandboxJson
      if (idempotencyKey) await store.set(idempotencyKey, fallbackAttempt)
      return res.status(502).json({ error: 'gateway_failure', details: fallbackAttempt })
    }

    if (idempotencyKey) await store.set(idempotencyKey, sandboxJson.result)
    return res.status(200).json({ result: sandboxJson.result })
  } catch (err: any) {
    console.error('orchestrator.error', err)
    return res.status(500).json({ error: 'internal_error', message: String(err?.message || err) })
  }
}

function createFakeRes() {
  const r: any = {}
  r._status = 200
  r._json = null
  r.status = (s: number) => { r._status = s; return r }
  r.json = (j: any) => { r._json = j; return r }
  return r
}
