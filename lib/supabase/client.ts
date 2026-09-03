import { createBrowserClient } from '@supabase/ssr'

const DEFAULT_SUPABASE_URL = 'https://hkraryqoziravulvqkid.supabase.co'
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ZC4p3GU0udH5eboge8QqeA_yhpJBXUl'

export function createSupabaseBrowserClient(): any | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return null

  const client = createBrowserClient(url, key)
  const originalGetUser = client.auth.getUser.bind(client.auth)
  client.auth.getUser = async (...args: any[]) => {
    const result = await originalGetUser(...args)
    if (result.error) return result
    const { data: sessionData } = await client.auth.getSession()
    return { ...result, data: { ...result.data, session: sessionData.session } }
  }
  return client
}
