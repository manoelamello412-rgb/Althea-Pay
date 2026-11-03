import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Service-role client: server only. (No 'server-only' package in the deps; this fails fast if a client bundle ever imports it.)
if (typeof window !== 'undefined') throw new Error('lib/supabase/admin must never run in the browser.')

let client: SupabaseClient | null = null

export function createSupabaseAdminClient(): SupabaseClient {
  if (client) return client

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serverKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY

  if (!url || !serverKey) {
    console.error('[ALTHEA-SUPABASE-ADMIN-CONFIG]', {
      hasUrl: Boolean(url),
      hasServerKey: Boolean(serverKey),
    })
    throw new Error('Supabase server configuration is missing.')
  }

  client = createClient(url, serverKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return client
}
