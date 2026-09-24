const isPreview = process.env.VERCEL_ENV === 'preview'

if (!isPreview) {
  console.log('Vercel Preview env preflight skipped: VERCEL_ENV is not preview.')
  process.exit(0)
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ''
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  ''

const missing = []
if (!supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL')
if (!publishableKey) {
  missing.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)')
}

if (missing.length) {
  console.error(`Vercel Preview env preflight failed: missing ${missing.join(', ')}.`)
  process.exit(1)
}

let parsedUrl
try {
  parsedUrl = new URL(supabaseUrl)
} catch {
  console.error('Vercel Preview env preflight failed: NEXT_PUBLIC_SUPABASE_URL is not a valid absolute URL.')
  process.exit(1)
}

if (parsedUrl.protocol !== 'https:') {
  console.error('Vercel Preview env preflight failed: NEXT_PUBLIC_SUPABASE_URL must use https.')
  process.exit(1)
}

console.log('Vercel Preview env preflight passed.')
