'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { CircleDollarSign, GitBranch, LayoutDashboard, LogOut, MessageCircle, Network, Package, RefreshCw, Search, Settings2, Sparkles, Webhook, X } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'

export type MobileShellTab = 'dashboard' | 'vendas' | 'chat' | 'ia' | 'funil'

type MenuItem = { label: string; href: string; icon?: typeof LayoutDashboard }
type MenuSection = { title: string; items: MenuItem[] }

const bottomTabs = [
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { id: 'vendas', label: 'Vendas', href: '/dashboard/vendas', icon: CircleDollarSign },
  { id: 'chat', label: 'Chat', href: '/dashboard/crm', icon: MessageCircle },
  { id: 'ia', label: 'IA', href: '/dashboard/ia', icon: Sparkles },
  { id: 'funil', label: 'Funis', href: '/dashboard/funil', icon: GitBranch },
] as const

const menuSections: MenuSection[] = [
  { title: 'CONFIGURAÇÃO DA OPERAÇÃO', items: [
    { label: 'Produtos', href: '/dashboard/produtos', icon: Package },
    { label: 'Gateways e conexões', href: '/dashboard/gateways', icon: Network },
    { label: 'Funis', href: '/dashboard/funil', icon: GitBranch },
    { label: 'Checkouts', href: '/dashboard/checkouts', icon: CircleDollarSign },
    { label: 'Pagamentos', href: '/dashboard/pagamentos', icon: CircleDollarSign },
  ] },
  { title: 'CLIENTES E RELACIONAMENTO', items: [
    { label: 'Clientes', href: '/dashboard/clientes', icon: MessageCircle },
    { label: 'Chat / CRM', href: '/dashboard/crm', icon: MessageCircle },
    { label: 'Recovery', href: '/dashboard/recovery', icon: RefreshCw },
  ] },
  { title: 'DADOS E INTELIGÊNCIA', items: [
    { label: 'Vendas', href: '/dashboard/vendas', icon: CircleDollarSign },
    { label: 'Analytics', href: '/dashboard/analytics', icon: CircleDollarSign },
    { label: 'IARA', href: '/dashboard/ia', icon: Sparkles },
  ] },
  { title: 'INTEGRAÇÕES', items: [
    { label: 'Integration Hub', href: '/dashboard/integration-hub', icon: Network },
    { label: 'API', href: '/dashboard/api', icon: Network },
    { label: 'Webhooks', href: '/dashboard/webhooks', icon: Webhook },
  ] },
  { title: 'ADMINISTRAÇÃO', items: [
    { label: 'Configurações gerais', href: '/dashboard/settings', icon: Settings2 },
    { label: 'Membros e acessos', href: '/dashboard/members', icon: Settings2 },
    { label: 'Segurança', href: '/dashboard/security', icon: Settings2 },
  ] },
  { title: 'SUPORTE', items: [
    { label: 'Central de ajuda', href: '/dashboard/help', icon: Settings2 },
  ] },
]

const searchableItems: Array<MenuItem & { section: string }> = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, section: 'VISÃO GERAL' },
  ...menuSections.flatMap(section => section.items.map(item => ({ ...item, section: section.title }))),
].filter((item, index, all) => all.findIndex(candidate => candidate.href === item.href) === index)

function sectionLabel(pathname: string): string {
  if (pathname.startsWith('/dashboard/funil')) return 'FUNIS'
  if (pathname.startsWith('/dashboard/vendas')) return 'VENDAS'
  if (pathname.startsWith('/dashboard/crm')) return 'CRM'
  if (pathname.startsWith('/dashboard/ia')) return 'IA'
  if (pathname.startsWith('/dashboard/produtos')) return 'PRODUTOS'
  if (pathname.startsWith('/dashboard/gateways')) return 'GATEWAYS'
  if (pathname.startsWith('/dashboard/checkouts')) return 'CHECKOUTS'
  if (pathname.startsWith('/dashboard/pagamentos')) return 'PAGAMENTOS'
  if (pathname.startsWith('/dashboard/clientes')) return 'CLIENTES'
  if (pathname.startsWith('/dashboard/analytics')) return 'ANALYTICS'
  if (pathname.startsWith('/dashboard/recovery')) return 'RECOVERY'
  if (pathname.startsWith('/dashboard/integration-hub')) return 'INTEGRAÇÕES'
  if (pathname.startsWith('/dashboard/api')) return 'API'
  if (pathname.startsWith('/dashboard/webhooks')) return 'WEBHOOKS'
  if (pathname.startsWith('/dashboard/settings')) return 'CONFIGURAÇÕES'
  if (pathname.startsWith('/dashboard/security')) return 'SEGURANÇA'
  if (pathname.startsWith('/dashboard/members')) return 'ACESSOS'
  if (pathname.startsWith('/dashboard/help')) return 'SUPORTE'
  return 'DASHBOARD'
}

function tabIsActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/dashboard/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function MobileShell({ activeTab: _activeTab, onTabChange, children }: { activeTab: MobileShellTab; onTabChange: (tab: MobileShellTab) => void; children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [searchOpen, setSearchOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [user, setUser] = useState({ name: 'Usuário', email: '—' })
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    import('@/lib/supabase/client').then(({ createSupabaseBrowserClient }) => {
      if (!active) return
      const db = createSupabaseBrowserClient()
      if (!db) return
      db.auth.getUser().then(({ data }) => {
        if (!active || !data.user) return
        setUser({ name: data.user.user_metadata?.display_name || data.user.user_metadata?.full_name || data.user.email?.split('@')[0] || 'Usuário', email: data.user.email || '—' })
      })
      const { data: auth } = db.auth.onAuthStateChange((_event, session) => {
        if (!active) return
        if (!session?.user) { setUser({ name: 'Usuário', email: '—' }); return }
        setUser({ name: session.user.user_metadata?.display_name || session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Usuário', email: session.user.email || '—' })
      })
      unsubscribe = () => auth.subscription.unsubscribe()
    })
    return () => { active = false; unsubscribe?.() }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
        setMenuOpen(false)
        return
      }

      if (!typing && event.key === '/') {
        event.preventDefault()
        setSearchOpen(true)
        setMenuOpen(false)
        return
      }

      if (event.key === 'Escape') {
        setSearchOpen(false)
        setQuery('')
        setMenuOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => { setSearchOpen(false); setQuery(''); setMenuOpen(false) }, [pathname])

  const searchResults = query.trim()
    ? searchableItems.filter(item => `${item.label} ${item.section}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : searchableItems.slice(0, 8)

  const selectTab = (tab: MobileShellTab) => onTabChange(tab)
  const navigateMenuItem = (item: MenuItem) => { if (item.href !== pathname) router.push(item.href); setMenuOpen(false) }
  const navigateSearchResult = (item: MenuItem) => {
    setQuery('')
    setSearchOpen(false)
    if (item.href !== pathname) router.push(item.href)
  }
  const handleSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    const { createSupabaseBrowserClient } = await import('@/lib/supabase/client')
    const db = createSupabaseBrowserClient()
    if (!db) { setSigningOut(false); return }
    const { error } = await db.auth.signOut()
    if (error) { setSigningOut(false); return }
    setMenuOpen(false)
    router.replace('/login')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-[var(--althea-bg)] text-white antialiased">
      <header className="fixed inset-x-0 top-0 z-[100] h-14 border-b border-white/[0.05] bg-[rgba(2,2,3,0.94)] px-4 backdrop-blur-xl sm:px-5">
        <div className="mx-auto flex h-full w-full max-w-[1440px] items-center justify-between gap-3">
          <button type="button" onClick={() => selectTab('dashboard')} aria-label="Ir para o Dashboard" className="flex min-w-0 items-center gap-2.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[rgba(29,184,84,.40)]">
            <img src="/althea-mark.png" alt="Althea Pay" className="h-6 w-6 shrink-0 object-contain" />
            <span className="h-4 w-px bg-white/[0.08]" />
            <span className="truncate text-[12px] font-semibold tracking-tight text-white">ALTHEA PAY <span className="text-[#5f6e66]">//</span> {sectionLabel(pathname)}</span>
          </button>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" aria-label="Buscar" aria-expanded={searchOpen} onClick={() => setSearchOpen((value) => !value)} className={`grid h-9 w-9 place-items-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(29,184,84,.40)] ${searchOpen ? 'bg-[rgba(29,184,84,.08)] text-[var(--althea-brand)]' : 'text-[var(--althea-muted)] hover:bg-white/[0.03] hover:text-white'}`}><Search size={17} strokeWidth={1.7} aria-hidden="true" /></button>
            <button type="button" aria-label="Abrir menu de configurações" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)} className={`grid h-9 w-9 place-items-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(29,184,84,.40)] ${menuOpen ? 'bg-[rgba(29,184,84,.08)] text-[var(--althea-brand)]' : 'text-[var(--althea-muted)] hover:bg-white/[0.03] hover:text-white'}`}><Settings2 size={18} strokeWidth={1.7} /></button>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {searchOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="absolute left-0 right-0 top-14 border-b border-white/[0.05] bg-[rgba(7,12,10,0.985)] px-4 py-3 shadow-[0_20px_60px_rgba(0,0,0,.45)] backdrop-blur-xl"
            >
              <div className="mx-auto w-full max-w-[1440px]">
                <div className="flex h-11 items-center gap-2 rounded-xl border border-white/[0.06] bg-[var(--althea-surface)] px-3">
                  <Search size={15} className="text-[var(--althea-muted)]" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && searchResults[0]) navigateSearchResult(searchResults[0])
                    }}
                    placeholder="Buscar módulos, áreas e configurações..."
                    aria-label="Pesquisar na plataforma"
                    className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[var(--althea-muted)]"
                  />
                  <span className="hidden rounded-md border border-white/[0.06] px-2 py-1 text-[9px] font-semibold text-[#637168] sm:inline">ESC</span>
                  <button type="button" aria-label="Fechar pesquisa" onClick={() => { setQuery(''); setSearchOpen(false) }} className="grid h-9 w-9 place-items-center text-[var(--althea-muted)] hover:text-white"><X size={16} /></button>
                </div>

                <div className="mt-2 overflow-hidden rounded-xl border border-white/[0.055] bg-[var(--althea-surface)]">
                  {searchResults.length > 0 ? (
                    <div className="grid gap-px bg-white/[0.035] sm:grid-cols-2 lg:grid-cols-4">
                      {searchResults.map(item => {
                        const Icon = item.icon ?? LayoutDashboard
                        return (
                          <button
                            key={item.href}
                            type="button"
                            onClick={() => navigateSearchResult(item)}
                            className="flex min-h-[72px] items-center gap-3 bg-[var(--althea-surface)] px-4 py-3 text-left transition hover:bg-[rgba(29,184,84,.055)]"
                          >
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[rgba(29,184,84,.10)] bg-[rgba(29,184,84,.05)] text-[var(--althea-brand)]">
                              <Icon size={16} />
                            </span>
                            <span className="min-w-0">
                              <b className="block truncate text-[10px] font-semibold text-white">{item.label}</b>
                              <small className="mt-1 block truncate text-[8px] text-[var(--althea-muted)]">{item.section}</small>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="px-4 py-5 text-center text-[10px] text-[var(--althea-muted)]">Nenhuma área encontrada para “{query}”.</div>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[8px] text-[#5e6c64]">
                  <span><b className="text-[var(--althea-muted)]">Enter</b> abre o primeiro resultado</span>
                  <span><b className="text-[var(--althea-muted)]">Ctrl/⌘ K</b> abre a busca</span>
                  <span><b className="text-[var(--althea-muted)]">/</b> busca rápida</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <AnimatePresence>{menuOpen && <><motion.button aria-label="Fechar menu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMenuOpen(false)} className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-sm" /><motion.aside initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 320, damping: 32 }} className="fixed right-0 top-0 z-[120] flex h-full w-[min(400px,94vw)] flex-col border-l border-white/[0.08] bg-[rgba(7,12,10,0.985)] shadow-[-30px_0_80px_rgba(0,0,0,0.65)]">
          <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-5"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#1DB854]/20 bg-[#1DB854]/[0.07] text-sm font-semibold text-[#63e08a]">{user.name.slice(0, 1).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-white">{user.name}</p><p className="truncate text-xs text-[var(--althea-muted)]">{user.email}</p></div><button type="button" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} className="grid h-10 w-10 place-items-center rounded-xl text-[var(--althea-muted)] hover:bg-white/[0.04] hover:text-white"><X size={20} /></button></div>
          <div className="flex-1 overflow-y-auto px-4 py-5 pb-8"><div className="mb-6 rounded-2xl border border-[#1DB854]/10 bg-[#1DB854]/[0.035] px-4 py-3"><p className="text-[10px] font-bold tracking-[0.22em] text-[var(--althea-brand)]">CONFIGURAÇÃO</p><p className="mt-1 text-xs leading-5 text-[#7f8b85]">Conecte, configure e ajuste os módulos da sua operação.</p></div>{menuSections.map((section) => <section key={section.title} className="mb-5"><h2 className="mb-2 px-2 text-[10px] font-bold tracking-[0.18em] text-[var(--althea-muted)]">{section.title}</h2><div className="space-y-1">{section.items.map((item) => { const Icon = item.icon; const active = tabIsActive(pathname, item.href); return <button key={`${section.title}-${item.label}`} type="button" onClick={() => navigateMenuItem(item)} className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm transition ${active ? 'border-[#1DB854]/20 bg-[#1DB854]/[0.075] text-[#62df89]' : 'border-transparent text-white/80 hover:border-white/[0.05] hover:bg-white/[0.035] hover:text-white'}`}>{Icon ? <Icon size={17} strokeWidth={1.7} /> : <span className="h-[17px] w-[17px]" />}<span className="flex-1">{item.label}</span>{active && <span className="h-1.5 w-1.5 rounded-full bg-[#1DB854]" />}</button> })}</div></section>)}</div>
          <div className="shrink-0 border-t border-white/[0.06] p-4"><button type="button" onClick={handleSignOut} disabled={signingOut} className="flex w-full items-center gap-3 rounded-xl border border-red-400/10 bg-red-400/[0.045] px-3 py-3 text-left text-sm font-medium text-red-300 transition hover:border-red-400/20 hover:bg-red-400/[0.08] disabled:cursor-wait disabled:opacity-60"><LogOut size={17} strokeWidth={1.8} /><span className="flex-1">{signingOut ? 'Saindo...' : 'Sair'}</span></button></div>
        </motion.aside></>}</AnimatePresence>

      <main className="min-w-0 pt-14 pb-[128px] lg:pb-10"><div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-5 lg:px-8">{children}</div></main>
      <nav className="fixed inset-x-0 bottom-0 z-[100] px-3 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 lg:hidden" aria-label="Navegação operacional"><div className="mx-auto grid h-[76px] w-full max-w-[760px] grid-cols-5 items-stretch gap-1 rounded-[38px] border border-white/[0.075] bg-[rgba(8,18,14,0.95)] p-1.5 shadow-[0_32px_64px_rgba(0,0,0,0.72)] backdrop-blur-2xl">{bottomTabs.map(({ id, label, icon: Icon, href }) => <Nav key={id} id={id} label={label} icon={Icon} active={tabIsActive(pathname, href)} onClick={selectTab} mobile />)}</div></nav>
    </div>
  )
}

function Nav({ id, label, icon: Icon, active, onClick, mobile = false }: { id: MobileShellTab; label: string; icon: typeof LayoutDashboard; active: boolean; onClick: (tab: MobileShellTab) => void; mobile?: boolean }) {
  return <motion.button type="button" aria-current={active ? 'page' : undefined} aria-label={label} onClick={() => onClick(id)} whileTap={{ scale: 0.97 }} className={`group relative flex min-w-0 items-center justify-center rounded-[30px] transition-all duration-200 ${mobile ? 'h-full flex-col gap-1.5 px-1' : 'w-full justify-start gap-2 px-3 py-3'} ${active ? 'text-[var(--althea-brand)]' : 'text-[var(--althea-muted)] hover:text-white'}`}><span aria-hidden="true" className={`absolute rounded-[30px] border transition-colors ${active ? 'inset-0 border-[rgba(29,184,84,0.22)] bg-[rgba(29,184,84,0.10)] shadow-[0_0_24px_rgba(29,184,84,0.06)]' : 'inset-0 border-transparent group-hover:bg-white/[0.02]'}`} /><Icon className="relative z-10 shrink-0" size={mobile ? 24 : 19} strokeWidth={active ? 2 : 1.8} /><span className={`relative z-10 max-w-full truncate leading-none ${mobile ? 'px-1 text-[10px] font-medium' : 'text-sm'}`}>{label}</span></motion.button>
}
