import { createBrowserClient } from '@supabase/ssr'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not configured. Set it in your environment before starting the app.`)
  }
  return value
}

export function createSupabaseBrowserClient(): any {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  // Next.js may prerender the client component during `next build`.
  // Defer the hard failure to the browser/runtime instead of breaking CI.
  if ((!url || !key) && typeof window === 'undefined') return {}

  const client = createBrowserClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'))
  const originalGetUser = client.auth.getUser.bind(client.auth)
  client.auth.getUser = async (...args: any[]) => {
    const result = await originalGetUser(...args)
    if (result.error) return result
    const { data: sessionData } = await client.auth.getSession()
    return { ...result, data: { ...result.data, session: sessionData.session } }
  }
  return client
}
