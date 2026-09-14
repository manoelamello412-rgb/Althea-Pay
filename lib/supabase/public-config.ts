function requirePublicConfig(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Supabase public configuration is missing. Set ${name} in the runtime environment.`
    )
  }
  return value
}

const SUPABASE_URL = requirePublicConfig(
  'NEXT_PUBLIC_SUPABASE_URL',
  process.env.NEXT_PUBLIC_SUPABASE_URL
)

const SUPABASE_PUBLISHABLE_KEY = requirePublicConfig(
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
)

export { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY }
