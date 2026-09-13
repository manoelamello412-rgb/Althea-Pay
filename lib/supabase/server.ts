import { createServerClient as createSSRServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './public-config'

export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createSSRServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Server Components cannot always write cookies. Proxy refreshes sessions.
        }
      },
    },
  })
}

// Backward-compatible alias for server routes that still use the legacy name.
export const createServerClient = createSupabaseServerClient
