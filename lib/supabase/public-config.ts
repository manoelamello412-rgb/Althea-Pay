function resolvePublicConfig(name: string, environmentValue: string | undefined): string {
  const value = environmentValue?.trim()
  if (!value) {
    throw new Error(
      `Supabase public configuration is missing. Set ${name} in the runtime environment.`
    )
  }
  return value
}

export function getSupabasePublicConfig() {
  return {
    url: resolvePublicConfig('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    publishableKey: resolvePublicConfig(
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
  }
}
