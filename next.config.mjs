// Dev only: allow a local Supabase (http/ws) and the eval React needs in development.
const dev = process.env.NODE_ENV !== 'production'
const localSupabase = dev && process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http://')
  ? ` ${process.env.NEXT_PUBLIC_SUPABASE_URL} ${process.env.NEXT_PUBLIC_SUPABASE_URL.replace('http://', 'ws://')}`
  : ''

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    // Public checkout routes are called from funnel pages on other domains. No cookies are involved,
    // so a wildcard origin adds nothing a server-side caller couldn't already do.
    // ponytail: wildcard origin; restrict to each funnel's saved page domain if abuse shows up.
    const publicCheckoutCors = [
      { key: 'Access-Control-Allow-Origin', value: '*' },
      { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
      { key: 'Access-Control-Allow-Headers', value: 'content-type' },
      { key: 'Access-Control-Max-Age', value: '600' },
    ]
    return [
      { source: '/api/checkout/public', headers: publicCheckoutCors },
      { source: '/api/payments/create', headers: publicCheckoutCors },
      { source: '/api/payments/action', headers: publicCheckoutCors },
      { source: '/althea.js', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }] },
      {
        source: '/(.*)',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "frame-ancestors 'none'",
              "form-action 'self'",
              "object-src 'none'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data: https:",
              "style-src 'self' 'unsafe-inline' https:",
              `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''} https:`,
              `connect-src 'self' https://*.supabase.co wss://*.supabase.co https:${localSupabase}`,
              "frame-src 'self' https://*.supabase.co https:",
              "worker-src 'self' blob:",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

export default nextConfig
