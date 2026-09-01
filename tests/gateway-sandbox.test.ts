import request from 'supertest'
import gatewaySandbox from '../supabase/functions/gateway-sandbox/index'

// We'll call the handler directly by mocking req/res

function makeRes() {
  const r: any = {}
  r.status = (s: number) => { r._status = s; return r }
  r.json = (j: any) => { r._json = j; return r }
  return r
}

describe('Gateway Sandbox', () => {
  it('approves a payment', async () => {
    const req: any = { method: 'POST', headers: {}, body: { amount: 1000, currency: 'BRL', scenario: 'approved' } }
    const res = makeRes()
    await gatewaySandbox(req, res)
    expect(res._status).toBe(200)
    expect(res._json.result.status).toBe('approved')
  })

  it('returns duplicate when same idempotency-key used', async () => {
    const headers = { 'idempotency-key': 'dup-key-1' }
    const req1: any = { method: 'POST', headers, body: { amount: 1000, scenario: 'approved' } }
    const res1 = makeRes()
    await gatewaySandbox(req1, res1)
    expect(res1._status).toBe(200)
    const req2: any = { method: 'POST', headers, body: { amount: 1000, scenario: 'approved' } }
    const res2 = makeRes()
    await gatewaySandbox(req2, res2)
    expect(res2._status).toBe(200)
    expect(res2._json.duplicate).toBe(true)
  })
})
