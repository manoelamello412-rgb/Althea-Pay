const FALLBACK_SUPABASE_URL = 'https://hkraryqoziravulvqkid.supabase.co'
const FALLBACK_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ZC4p3GU0udH5eboge8QqeA_yhpJBXUl'

function resolvePublicConfig(name: string, environmentValue: string | undefined, fallback: string): string {
  const value = environmentValue?.trim() || fallback
  if (!value) {
    throw new Error(
      `Supabase public configuration is missing. Set ${name} in the runtime environment.`
    )
  }
  return value
}

export function getSupabasePublicConfig() {
  return {
    url: resolvePublicConfig(
      'NEXT_PUBLIC_SUPABASE_URL',
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      FALLBACK_SUPABASE_URL,
    ),
    publishableKey: resolvePublicConfig(
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      FALLBACK_SUPABASE_PUBLISHABLE_KEY,
    ),
  }
}
