'use client'

import { usePathname } from 'next/navigation'

/**
 * Legacy navigation kept as a compatibility boundary for older dashboard
 * surfaces. The canonical operational navigation now lives in MobileShell.
 * Returning null on dashboard routes prevents duplicate bottom bars while
 * allowing any non-dashboard legacy consumer to keep its previous behavior.
 */
export function MobileBottomNav() {
  const pathname = usePathname()

  if (pathname.startsWith('/dashboard')) return null

  return null
}

export default MobileBottomNav
