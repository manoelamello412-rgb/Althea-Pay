'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { LayoutGrid, MessageSquare, Network, Search, Settings, Sparkles, X } from 'lucide-react'
import BrandLogo from '@/components/brand-logo'

interface NavigationRoute { id: string; label: string; href: string; icon: ComponentType<{ className?: string }> }

const routes: readonly NavigationRoute[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: LayoutGrid },
  { id: 'gateway', label: 'Gateway', href: '/dashboard/gateways', icon: Network },
  { id: 'chat', label: 'Multi-CRM', href: '/dashboard/crm', icon: MessageSquare },
  { id: 'ia', label: 'IA', href: '/dashboard/ia', icon: Sparkles },
  { id: 'config', label: 'Configuração', href: '/dashboard/settings', icon: Settings },
]

function isRouteActive(pathname: string, route: NavigationRoute): boolean {
  if (route.id === 'dashboard') return pathname === '/dashboard' || pathname === '/dashboard/'
  return pathname === route.href || pathname.startsWith(`${route.href}/`)
}

export function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const filteredRoutes = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR')
    return query ? routes.filter((route) => route.label.toLocaleLowerCase('pt-BR').includes(query)) : routes
  }, [search])

  useEffect(() => {
    if (!searchOpen) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setSearchOpen(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [searchOpen])

  const activeRoute = routes.find((route) => isRouteActive(pathname, route)) ?? routes[0]

  return (
    <div className="min-h-screen bg-[var(--althea-bg)] text-white antialiased selection:bg-[var(--althea-brand)] selection:text-black">
      <header className="sticky top-0 z-[60] flex h-16 items-center justify-between border-b border-white/[0.06] bg-[rgba(11,11,13,0.94)] px-4 backdrop-blur-xl sm:px-6 lg:px-8">
        <Link href="/dashboard" aria-label="Althea Pay — Dashboard" className="flex h-full min-w-0 items-center">
          <BrandLogo variant="inner" priority alt="Althea Pay" className="h-11 w-auto max-w-[190px] object-contain drop-shadow-[0_0_22px_rgba(29,187,84,0.2)] sm:h-12 sm:max-w-[210px]" />
        </Link>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <button type="button" onClick={() => { setSearch(''); setSearchOpen(true) }} aria-label="Buscar" title="Buscar" className="grid h-11 w-11 place-items-center rounded-xl text-[var(--althea-muted)] transition hover:bg-white/[0.04] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(29,187,84,0.45)]">
            <Search className="h-5 w-5" aria-hidden="true" />
          </button>
          <Link href="/dashboard/settings" aria-label="Configurações" title="Configurações" className="grid h-11 w-11 place-items-center rounded-xl text-[var(--althea-muted)] transition hover:bg-white/[0.04] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(29,187,84,0.45)]">
            <Settings className="h-5 w-5" aria-hidden="true" />
          </Link>
        </div>
      </header>

      {searchOpen ? (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/70 px-4 pt-[max(88px,12vh)] backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Busca global">
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/[0.08] bg-[var(--althea-surface)] shadow-2xl">
            <div className="flex items-center gap-3 border-b border-white/[0.06] px-4">
              <Search className="h-5 w-5 shrink-0 text-[var(--althea-muted)]" aria-hidden="true" />
              <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar no ALTHEA PAY..." aria-label="Buscar no ALTHEA PAY" className="h-14 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600" />
              <button type="button" onClick={() => setSearchOpen(false)} aria-label="Fechar busca" className="grid h-9 w-9 place-items-center rounded-lg text-zinc-500 hover:bg-white/[0.04] hover:text-white"><X className="h-4 w-4" aria-hidden="true" /></button>
            </div>
            <nav aria-label="Resultados da busca" className="max-h-[55vh] overflow-y-auto p-2">
              {filteredRoutes.length ? filteredRoutes.map((route) => { const Icon = route.icon; return <Link key={route.id} href={route.href} onClick={() => setSearchOpen(false)} className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm text-zinc-300 transition hover:bg-white/[0.04] hover:text-white"><Icon className="h-4 w-4 text-[var(--althea-brand)]" aria-hidden="true" />{route.label}</Link> }) : <p className="px-3 py-6 text-center text-sm text-zinc-500">Nenhum resultado encontrado.</p>}
            </nav>
          </div>
        </div>
      ) : null}

      <div className="flex min-h-[calc(100vh-4rem)]">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 flex-col justify-between border-r border-white/[0.04] bg-[var(--althea-surface)]/80 p-5 backdrop-blur-xl lg:flex">
          <nav aria-label="Navegação principal" className="space-y-1">
            {routes.map((route) => { const Icon = route.icon; const active = isRouteActive(pathname, route); return <Link key={route.id} href={route.href} aria-current={active ? 'page' : undefined} className={`relative flex h-10 w-full items-center gap-3 rounded-xl border px-3 text-xs font-medium transition-all duration-200 ${active ? 'border-[rgba(29,187,84,0.2)] bg-[rgba(29,187,84,0.08)] font-semibold text-[var(--althea-brand)] shadow-[0_0_20px_rgba(29,187,84,0.08)]' : 'border-transparent text-[var(--althea-muted)] hover:bg-white/[0.02] hover:text-zinc-200'}`}><Icon className="h-4 w-4" aria-hidden="true" /><span>{route.label}</span></Link> })}
          </nav>
          <div className="px-1 font-mono text-[9px] uppercase tracking-wider text-[color-mix(in_srgb,var(--althea-muted)_40%,transparent)]">ALTHEA CORE // SYSTEM HARDENED</div>
        </aside>

        <div className="min-w-0 flex-1">
          <main className="min-w-0 px-4 py-6 pb-32 sm:px-6 lg:px-8 lg:py-8 lg:pb-10"><div className="mx-auto w-full max-w-[1440px]">{children}</div></main>
        </div>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-4 lg:hidden">
        <nav aria-label="Navegação móvel" className="pointer-events-auto mx-auto grid h-16 w-full max-w-md grid-cols-5 items-center gap-1 rounded-2xl border border-white/[0.06] bg-[rgba(13,54,45,0.86)] p-1.5 shadow-[0_32px_64px_rgba(0,0,0,0.7)] backdrop-blur-xl">
          {routes.map((route) => { const Icon = route.icon; const active = isRouteActive(pathname, route); return <Link key={route.id} href={route.href} aria-current={active ? 'page' : undefined} className={`flex h-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl transition-all ${active ? 'bg-[rgba(29,187,84,0.08)] text-[var(--althea-brand)] shadow-[inset_0_0_0_1px_rgba(29,187,84,0.2)]' : 'text-zinc-500 hover:text-zinc-300'}`}><Icon className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="max-w-full truncate px-1 text-[9px] font-medium leading-none">{route.label}</span></Link> })}
        </nav>
      </div>
    </div>
  )
}

export default AppLayout
