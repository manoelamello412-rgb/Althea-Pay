import { simulateSandboxPayment } from '../_shared/gateway-sandbox-sim.ts'
import { IdempotencyStore } from '../../../lib/idempotency'
import { verifyHMAC } from '../../../lib/hmac'

const store = new IdempotencyStore()

// Simple handler for the sandbox gateway. Designed to be used as a serverless function.
export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' })
      return
    }

    const idempotencyKey = req.headers['idempotency-key'] || req.headers['Idempotency-Key']
    if (!idempotencyKey) {
      // Allow sandbox to be used without idempotency for quick tests, but recommend providing it.
      // For production this header is required.
      // We'll still accept the request.
    } else {
      const seen = await store.get(idempotencyKey)
      if (seen) {
        res.status(200).json({ duplicate: true, result: seen })
        return
      }
    }

    const payload = req.body || {}
    // simulate
    const result = simulateSandboxPayment(payload)

    // store idempotency
    if (idempotencyKey) await store.set(idempotencyKey, result)

    // emit simple webhook log (in real deploy, this would call ALTHEA webhook queue)
    console.log('sandbox.payment', { result })

    res.status(200).json({ result })
  } catch (err: any) {
    console.error('sandbox.error', err)
    res.status(500).json({ error: 'internal_error', message: String(err?.message || err) })
  }
}
