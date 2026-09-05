import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

let browserClient: SupabaseClient | undefined

function requireBrowserEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function getBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient

  if (typeof window === 'undefined') {
    throw new Error('Supabase browser client accessed before browser hydration')
  }

  browserClient = createBrowserClient(
    requireBrowserEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireBrowserEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  )

  return browserClient
}

const lazyBrowserClient = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const client = getBrowserClient()
    const value = Reflect.get(client as object, property)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

export function createSupabaseBrowserClient(): SupabaseClient {
  return lazyBrowserClient
}
