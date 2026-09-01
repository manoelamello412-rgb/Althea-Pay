type SandboxScenario = 'approved' | 'declined' | 'technical_failure'

type SandboxRequest = {
  amount?: number
  currency?: string
  idempotency_key?: string
  scenario?: SandboxScenario
  external_id?: string
  metadata?: Record<string, unknown>
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: SandboxRequest
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  if (!body.idempotency_key || typeof body.idempotency_key !== 'string') {
    return json({ error: 'idempotency_key_required' }, 400)
  }

  if (typeof body.amount !== 'number' || body.amount <= 0) {
    return json({ error: 'amount_must_be_positive' }, 400)
  }

  const scenario = body.scenario ?? 'approved'
  // Deterministic by idempotency key so a retry can reproduce the same sandbox transaction.
  const externalId = body.external_id ?? `sandbox_${body.idempotency_key}`
  const now = new Date().toISOString()

  if (scenario === 'declined') {
    return json({
      ok: true,
      sandbox: true,
      approved: false,
      retryable: false,
      status: 'declined',
      failure_code: 'sandbox_card_declined',
      external_id: externalId,
      idempotency_key: body.idempotency_key,
      occurred_at: now,
    })
  }

  if (scenario === 'technical_failure') {
    return json({
      ok: false,
      sandbox: true,
      approved: false,
      retryable: true,
      status: 'technical_failure',
      failure_code: 'sandbox_provider_unavailable',
      external_id: externalId,
      idempotency_key: body.idempotency_key,
      occurred_at: now,
    }, 502)
  }

  return json({
    ok: true,
    sandbox: true,
    approved: true,
    retryable: false,
    status: 'approved',
    external_id: externalId,
    idempotency_key: body.idempotency_key,
    amount: body.amount,
    currency: body.currency ?? 'BRL',
    metadata: body.metadata ?? {},
    occurred_at: now,
  })
})
