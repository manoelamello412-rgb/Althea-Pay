import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://hkraryqoziravulvqkid.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ZC4p3GU0udH5eboge8QqeA_yhpJBXUl'

let browserClient: SupabaseClient | undefined

type BrowserSupabaseClient = Omit<SupabaseClient, 'rpc'> & {
  rpc: (fn: string, args?: Record<string, unknown>, options?: { head?: boolean; get?: boolean }) => Promise<any>
}

function getBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient

  if (typeof window === 'undefined') {
    throw new Error('Supabase browser client accessed before browser hydration')
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
