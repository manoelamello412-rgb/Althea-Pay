import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabasePublicConfig } from './public-config'

let browserClient: SupabaseClient | undefined

type BrowserSupabaseClient = Omit<SupabaseClient, 'rpc'> & {
  rpc: (fn: string, args?: Record<string, unknown>, options?: { head?: boolean; get?: boolean }) => Promise<any>
}

function getBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient

  if (typeof window === 'undefined') {
    throw new Error('Supabase browser client accessed before browser hydration')
  }

  const { url, publishableKey } = getSupabasePublicConfig()
  browserClient = createBrowserClient(url, publishableKey)
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
