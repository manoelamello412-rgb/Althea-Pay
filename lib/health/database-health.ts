import { createSupabaseServerClient } from '@/lib/supabase/server'

type DatabaseHealth = {
  ok: boolean
  status: 'ok' | 'error'
  latency_ms: number
  database_time?: string
}

export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  const startedAt = Date.now()

  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.rpc('health_database_ping_v1')

    if (error || !data || typeof data !== 'object' || data.ok !== true) {
      return { ok: false, status: 'error', latency_ms: Date.now() - startedAt }
    }

    return {
      ok: true,
      status: 'ok',
      latency_ms: Date.now() - startedAt,
      database_time: typeof data.database_time === 'string' ? data.database_time : undefined,
    }
  } catch {
    return { ok: false, status: 'error', latency_ms: Date.now() - startedAt }
  }
}
