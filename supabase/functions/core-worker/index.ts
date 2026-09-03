import { withSupabase } from 'npm:@supabase/server'

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'content-type': 'application/json' } })

Deno.serve(withSupabase({ auth: 'none' }, async (req, ctx) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
  const expected = Deno.env.get('ALTHEA_INTERNAL_SECRET') || ''
  const provided = req.headers.get('x-internal-secret') || ''
  if (!expected || provided !== expected) return json({ ok: false, error: 'unauthorized' }, 401)

  const db = ctx.supabaseAdmin
  const workerId = `core-worker:${crypto.randomUUID()}`
  const body = await req.json().catch(() => ({})) as { limit?: unknown }
  const limit = Math.min(Math.max(Number(body.limit || 10), 1), 50)

  const recovered = await db.rpc('recover_stale_core_jobs', { p_stale_minutes: 10 })
  if (recovered.error) return json({ ok: false, error: 'recovery_failed' }, 500)

  const claimed = await db.rpc('claim_core_jobs', { p_worker_id: workerId, p_limit: limit })
  if (claimed.error) return json({ ok: false, error: 'claim_failed' }, 500)

  const jobs = Array.isArray(claimed.data) ? claimed.data : []
  const results: Array<{ id: string; status: string; error?: string }> = []

  for (const job of jobs) {
    try {
      if (job.job_type === 'integration_event_retry') {
        const eventId = String(job.payload?.event_id || '')
        if (!eventId) throw new Error('missing_event_id')
        const supabaseUrl = Deno.env.get('SUPABASE_URL')
        if (!supabaseUrl) throw new Error('supabase_url_not_configured')
        const response = await fetch(`${supabaseUrl}/functions/v1/integration-event-processor`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-internal-secret': expected },
          body: JSON.stringify({ event_id: eventId }),
        })
        if (!response.ok) throw new Error(`processor_http_${response.status}`)
      } else {
        throw new Error(`unsupported_job_type:${job.job_type}`)
      }

      const done = await db.rpc('finish_core_job', { p_job_id: job.id, p_success: true })
      if (done.error) throw done.error
      results.push({ id: job.id, status: 'completed' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'job_failed'
      const done = await db.rpc('finish_core_job', { p_job_id: job.id, p_success: false, p_error: message })
      results.push({ id: job.id, status: done.error ? 'failed' : (done.data?.status || 'retry'), error: message })
    }
  }

  return json({ ok: true, worker_id: workerId, recovered: recovered.data || 0, claimed: jobs.length, results })
}))
