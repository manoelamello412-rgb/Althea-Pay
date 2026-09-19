import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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
