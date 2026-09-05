import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

let browserClient: SupabaseClient | undefined

function requireBrowserEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export function createSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient

  if (typeof window === 'undefined') {
    // Client components can be prerendered by Next.js. The browser client must
    // only be constructed with public runtime configuration in the browser.
    return undefined as unknown as SupabaseClient
  }

  browserClient = createBrowserClient(
    requireBrowserEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireBrowserEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  )

  return browserClient
}
