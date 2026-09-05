import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './public-config'

let browserClient: SupabaseClient | undefined

function getBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient

  if (typeof window === 'undefined') {
    throw new Error('Supabase browser client accessed before browser hydration')
  }

  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? SUPABASE_PUBLISHABLE_KEY,
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
