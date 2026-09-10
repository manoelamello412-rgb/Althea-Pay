import { createServerClient as createSSRServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './public-config'

export async function createSupabaseServerClient() {
  const cookieStore = await cookies()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? SUPABASE_PUBLISHABLE_KEY

  return createSSRServerClient(url, key, {
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
