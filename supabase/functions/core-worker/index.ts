import { withSupabase } from 'npm:@supabase/server'

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'content-type': 'application/json' } })

Deno.serve(withSupabase({ auth: 'none' }, async (req, ctx) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
  const secret = Deno.env.get('ALTHEA_INTERNAL_SECRET') || ''
  if (!secret || req.headers.get('x-internal-secret') !== secret) return json({ ok: false, error: 'unauthorized' }, 401)
  const db = ctx.supabaseAdmin
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const limit = Math.min(Math.max(Number(body.limit || 10), 1), 50)
  const recovered = await db.rpc('recover_stale_core_jobs', { p_stale_after: '10 minutes' })
  if (recovered.error) return json({ ok: false, error: 'recovery_failed' }, 500)
  const workerId = `core-worker:${crypto.randomUUID()}`
  const claimed = await db.rpc('claim_core_jobs', { p_worker_id: workerId, p_limit: limit })
  if (claimed.error) return json({ ok: false, error: 'claim_failed' }, 500)
  const jobs = Array.isArray(claimed.data) ? claimed.data : []
  const results: Array<{ id: string; status: string; error?: string }> = []
  for (const job of jobs) {
    try {
      if (job.job_type !== 'integration_event_retry') throw new Error(`unsupported_job_type:${job.job_type}`)
      const eventId = String(job.payload?.event_id || '')
      if (!eventId) throw new Error('missing_event_id')
      const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/integration-event-processor`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': secret }, body: JSON.stringify({ event_id: eventId }) })
      if (!response.ok) throw new Error(`processor_http_${response.status}`)
      const done = await db.rpc('finish_core_job', { p_job_id: job.id, p_success: true })
      if (done.error) throw done.error
      results.push({ id: job.id, status: 'completed' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'job_failed'
      const done = await db.rpc('finish_core_job', { p_job_id: job.id, p_success: false, p_error: message })
      results.push({ id: job.id, status: done.error ? 'failed' : String(done.data?.status || 'retry'), error: message })
    }
  }
  return json({ ok: true, worker_id: workerId, recovered: Number(recovered.data || 0), claimed: jobs.length, results })
}))
