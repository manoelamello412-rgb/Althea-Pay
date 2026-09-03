import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const DEFAULT_SUPABASE_URL = 'https://hkraryqoziravulvqkid.supabase.co'
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ZC4p3GU0udH5eboge8QqeA_yhpJBXUl'

function resolveEnv(fallback: string, ...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]
    if (value) return value
  }
  return fallback
}

export async function proxy(request: NextRequest) {
  const url = resolveEnv(DEFAULT_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL')
  const key = resolveEnv(
    DEFAULT_SUPABASE_PUBLISHABLE_KEY,
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_ANON_KEY',
  )
  const isLogin = request.nextUrl.pathname === '/login'

  let response = NextResponse.next({ request })
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() { return request.cookies.getAll() },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value, options))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  const { data: claimsData } = await supabase.auth.getClaims()
  const isAuthenticated = Boolean(claimsData)

  if (!isAuthenticated && !isLogin) {
    const target = request.nextUrl.clone()
    target.pathname = '/login'
    target.searchParams.set('next', request.nextUrl.pathname)
    return NextResponse.redirect(target)
  }

  if (isAuthenticated && isLogin) return NextResponse.redirect(new URL('/', request.url))
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
