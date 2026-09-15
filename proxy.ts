import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (!url || !key) return null
  return { url, key }
}

export async function proxy(request: NextRequest) {
  const config = getSupabaseConfig()
  if (!config) {
    return new NextResponse('Supabase authentication is not configured for this deployment.', {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  const pathname = request.nextUrl.pathname
  const isLogin = pathname === '/login'
  const isPublicCheckout = pathname === '/checkout' || pathname.startsWith('/checkout/')
  let response = NextResponse.next({ request })
  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  const { data: claimsData } = await supabase.auth.getClaims()
  const isAuthenticated = Boolean(claimsData)

  if (!isAuthenticated && !isLogin && !isPublicCheckout) {
    const target = request.nextUrl.clone()
    target.pathname = '/login'
    target.searchParams.set('next', pathname)
    return NextResponse.redirect(target)
  }

  if (isAuthenticated && isLogin) return NextResponse.redirect(new URL('/dashboard', request.url))
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
