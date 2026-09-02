import { simulateSandboxPayment } from '../_shared/gateway-sandbox-sim.ts'

// Sandbox-only idempotency. Production payment flows use the durable
// idempotency infrastructure elsewhere in the platform.
const idempotencyStore = new Map<string, unknown>()

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' })
      return
    }

    const idempotencyKey =
      req.headers['idempotency-key'] ||
      req.headers['Idempotency-Key'] ||
      req.headers['idempotency_key']

    if (idempotencyKey) {
      const seen = idempotencyStore.get(idempotencyKey)
      if (seen) {
        res.status(200).json({ duplicate: true, result: seen })
        return
      }
    }

    const payload = req.body || {}
    const result = simulateSandboxPayment(payload)

    if (idempotencyKey) {
      idempotencyStore.set(idempotencyKey, result)
    }

    console.log('sandbox.payment', { result })
    res.status(200).json({ result })
  } catch (err: any) {
    console.error('sandbox.error', err)
    res.status(500).json({
      error: 'internal_error',
      message: String(err?.message || err),
    })
  }
}
