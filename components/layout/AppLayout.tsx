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
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between border-r border-white/[0.04] bg-[color-mix(in_srgb,var(--althea-surface)_78%,transparent)] p-5 backdrop-blur-xl md:flex">
        <div className="space-y-6">
          <Link href="/dashboard" aria-label="ALTHEA PAY — Dashboard" className="flex items-center gap-3 px-1 py-1">
            <BrandLogo variant="mark" priority className="h-8 w-8 object-contain drop-shadow-[0_0_20px_rgba(29,187,84,0.2)]" />
            <span className="font-mono text-xs font-bold tracking-widest text-zinc-100">ALTHEA PAY</span>
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
                      ? 'border-[rgba(29,187,84,0.2)] bg-[rgba(29,187,84,0.08)] font-semibold text-[var(--althea-brand)]'
                      : 'border-transparent text-[var(--althea-muted)] hover:bg-white/[0.02] hover:text-zinc-200'
                  }`}
                >
                  <Icon className={`h-4 w-4 ${active ? 'text-[var(--althea-brand)] drop-shadow-[0_0_20px_rgba(29,187,84,0.2)]' : 'text-[var(--althea-muted)]'}`} />
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
        <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-white/[0.04] bg-[color-mix(in_srgb,var(--althea-bg)_86%,transparent)] px-4 backdrop-blur-xl md:hidden">
          <Link href="/dashboard" aria-label="Voltar ao Dashboard" className="flex min-w-0 items-center gap-2">
            <BrandLogo variant="mark" priority className="h-6 w-6 object-contain" />
            <span className="font-mono text-[10px] font-semibold tracking-[0.14em] text-zinc-100">ALTHEA PAY</span>
          </Link>
          <span className="truncate pl-3 font-mono text-[10px] uppercase tracking-wider text-[var(--althea-muted)]">
            {activeRoute.label}
          </span>
        </header>

        <main className="min-w-0 px-4 py-6 pb-32 md:px-8 md:py-8 md:pb-10">
          {children}
        </main>
      </div>
    </div>
  )
}

export default AppLayout
