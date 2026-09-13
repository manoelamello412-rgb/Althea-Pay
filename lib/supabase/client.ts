import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

let browserClient: SupabaseClient | undefined

type BrowserSupabaseClient = Omit<SupabaseClient, 'rpc'> & {
  rpc: (fn: string, args?: Record<string, unknown>, options?: { head?: boolean; get?: boolean }) => Promise<any>
}

function getBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient

  if (typeof window === 'undefined') {
    throw new Error('Supabase browser client accessed before browser hydration')
  }

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      'Supabase browser configuration is missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.'
    )
  }

  browserClient = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  return browserClient
}

const lazyBrowserClient = new Proxy({} as BrowserSupabaseClient, {
  get(_target, property) {
    const client = getBrowserClient()
    const value = Reflect.get(client as object, property)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

export function createSupabaseBrowserClient(): BrowserSupabaseClient {
  return lazyBrowserClient
}
