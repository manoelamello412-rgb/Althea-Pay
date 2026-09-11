'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ComponentType, ReactNode } from 'react'
import {
  LayoutGrid,
  MessageSquare,
  Network,
  Settings,
  Sparkles,
} from 'lucide-react'
import BrandLogo from '@/components/brand-logo'

interface NavigationRoute {
  id: string
  label: string
  href: string
  icon: ComponentType<{ className?: string }>
}

const routes: readonly NavigationRoute[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: LayoutGrid },
  { id: 'gateway', label: 'Gateway', href: '/dashboard/gateways', icon: Network },
  { id: 'chat', label: 'Chat', href: '/dashboard/crm', icon: MessageSquare },
  { id: 'ia', label: 'IA', href: '/dashboard/ia', icon: Sparkles },
  { id: 'config', label: 'Configuração', href: '/dashboard/settings', icon: Settings },
]

function isRouteActive(pathname: string, route: NavigationRoute): boolean {
  if (route.id === 'dashboard') return pathname === '/dashboard' || pathname === '/dashboard/'
  return pathname === route.href || pathname.startsWith(`${route.href}/`)
}

export function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const activeRoute = routes.find((route) => isRouteActive(pathname, route)) ?? routes[0]

  return (
    <div className="min-h-screen bg-[var(--althea-bg)] text-white antialiased selection:bg-[var(--althea-brand)] selection:text-black md:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between border-r border-white/[0.04] bg-[var(--althea-surface)]/80 p-5 backdrop-blur-xl md:flex">
        <div className="space-y-6">
          <Link href="/dashboard" aria-label="ALTHEA PAY — Dashboard" className="flex items-center gap-3 px-1 py-1">
            <BrandLogo variant="inner" priority alt="ALTHEA PAY" className="h-8 w-auto object-contain drop-shadow-[0_0_20px_rgba(29,187,84,0.2)]" />
          </Link>

          <nav aria-label="Navegação principal" className="space-y-1">
            {routes.map((route) => {
              const Icon = route.icon
              const active = isRouteActive(pathname, route)
              return (
                <Link
                  key={route.id}
                  href={route.href}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex h-10 w-full items-center gap-3 rounded-xl border px-3 text-xs font-medium transition-all duration-200 ${
                    active
                      ? 'border-[rgba(29,187,84,0.2)] bg-[rgba(29,187,84,0.08)] font-semibold text-[var(--althea-brand)] shadow-[0_0_20px_rgba(29,187,84,0.08)]'
                      : 'border-transparent text-[var(--althea-muted)] hover:bg-white/[0.02] hover:text-zinc-200'
                  }`}
                >
                  <Icon className={`h-4 w-4 ${active ? 'text-[var(--althea-brand)]' : 'text-[var(--althea-muted)]'}`} />
                  <span>{route.label}</span>
                </Link>
              )
            })}
          </nav>
        </div>

        <div className="px-1 font-mono text-[9px] uppercase tracking-wider text-[color-mix(in_srgb,var(--althea-muted)_40%,transparent)]">
          ALTHEA CORE // SYSTEM HARDENED
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-white/[0.04] bg-[var(--althea-bg)]/90 px-4 backdrop-blur-xl md:hidden">
          <Link href="/dashboard" aria-label="Voltar ao Dashboard" className="flex min-w-0 items-center gap-2">
            <BrandLogo variant="inner" priority alt="ALTHEA PAY" className="h-6 w-auto max-w-[132px] object-contain" />
          </Link>
          <span className="truncate pl-3 font-mono text-[10px] uppercase tracking-wider text-[var(--althea-muted)]">
            {activeRoute.label}
          </span>
        </header>

        <main className="min-w-0 px-4 py-6 pb-32 md:px-8 md:py-8 md:pb-10">
          <div className="mx-auto w-full max-w-[1280px]">{children}</div>
        </main>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-4 md:hidden bg-gradient-to-t from-[var(--althea-bg)] via-[var(--althea-bg)]/90 to-transparent">
        <nav aria-label="Navegação móvel" className="pointer-events-auto mx-auto grid h-16 w-full max-w-md grid-cols-5 items-center gap-1 rounded-2xl border border-white/[0.06] bg-[rgba(13,54,45,0.72)] p-1.5 shadow-[0_32px_64px_rgba(0,0,0,0.7)] backdrop-blur-xl">
          {routes.map((route) => {
            const Icon = route.icon
            const active = isRouteActive(pathname, route)
            return (
              <Link
                key={route.id}
                href={route.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl transition-all ${
                  active
                    ? 'bg-[rgba(29,187,84,0.08)] text-[var(--althea-brand)] shadow-[inset_0_0_0_1px_rgba(29,187,84,0.2)]'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="max-w-full truncate px-1 text-[9px] font-medium leading-none">{route.label}</span>
              </Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}

export default AppLayout
