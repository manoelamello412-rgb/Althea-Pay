const fallback = '/dashboard'

/** Accept only local application paths, never external URLs or auth loops. */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return fallback
  try {
    const url = new URL(value, 'https://althea.invalid')
    if (url.origin !== 'https://althea.invalid' || ['/login', '/forgot-password', '/reset-password'].includes(url.pathname.replace(/\/$/, ''))) return fallback
    return url.pathname + url.search + url.hash
  } catch { return fallback }
}

export function authLink(path: '/login' | '/forgot-password' | '/reset-password', search: string): string {
  const next = new URLSearchParams(search).get('next')
  return next ? `${path}?${new URLSearchParams({ next: safeNext(next) })}` : path
}

export function nextFromSearch(search: string): string {
  return safeNext(new URLSearchParams(search).get('next'))
}
