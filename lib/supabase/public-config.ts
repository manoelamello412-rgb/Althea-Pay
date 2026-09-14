function requirePublicConfig(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Supabase public configuration is missing. Set ${name} in the runtime environment.`
    )
  }
  return value
}

export function getSupabasePublicConfig() {
  return {
    url: requirePublicConfig('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    publishableKey: requirePublicConfig(
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ),
  }
}
