'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { CircleDollarSign, GitBranch, LayoutDashboard, Menu, MessageCircle, Network, Search, Sparkles, X } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'

export type MobileShellTab = 'dashboard' | 'vendas' | 'chat' | 'ia' | 'funil'

type MenuItem = {
  label: string
  href?: string
  mobilePage?: string
  icon?: typeof LayoutDashboard
}

type MenuSection = {
  title: string
  items: MenuItem[]
}

const bottomTabs = [
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard', mobilePage: null, icon: LayoutDashboard },
  { id: 'vendas', label: 'Vendas', href: '/dashboard', mobilePage: 'vendas', icon: CircleDollarSign },
  { id: 'chat', label: 'Chat', href: '/dashboard/crm', mobilePage: null, icon: MessageCircle },
  { id: 'ia', label: 'IA', href: '/dashboard/ia', mobilePage: null, icon: Sparkles },
  { id: 'funil', label: 'Funil', href: '/dashboard/funil', mobilePage: null, icon: GitBranch },
] as const

const menuSections: MenuSection[] = [
  { title: 'OPERAR', items: [
    { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { label: 'Vendas', href: '/dashboard', mobilePage: 'vendas', icon: CircleDollarSign },
  ] },
  { title: 'RECEBER', items: [
    { label: 'Gateways', href: '/dashboard/gateways', icon: Network },
    { label: 'Pagamentos', href: '/dashboard', mobilePage: 'pagamentos' },
  ] },
  { title: 'VENDER', items: [
    { label: 'Funis', href: '/dashboard/funil', icon: GitBranch },
    { label: 'Checkouts', href: '/dashboard', mobilePage: 'checkouts' },
  ] },
  { title: 'RELACIONAR', items: [
    { label: 'Clientes', href: '/dashboard', mobilePage: 'clientes' },
    { label: 'Chat / CRM', href: '/dashboard/crm', icon: MessageCircle },
  ] },
  { title: 'ANALISAR', items: [
    { label: 'Analytics', href: '/dashboard', mobilePage: 'analytics' },
    { label: 'IA', href: '/dashboard/ia', icon: Sparkles },
  ] },
  { title: 'INTEGRAÇÕES', items: [
    { label: 'Integration Hub', href: '/dashboard', mobilePage: 'integrations' },
    { label: 'API', href: '/dashboard', mobilePage: 'api' },
    { label: 'Webhooks', href: '/dashboard', mobilePage: 'webhooks' },
  ] },
  { title: 'ADMINISTRAÇÃO', items: [
    { label: 'Configurações', href: '/dashboard/settings' },
    { label: 'Membros e acessos', href: '/dashboard/settings', mobilePage: 'members' },
    { label: 'Segurança', href: '/dashboard/settings', mobilePage: 'security' },
  ] },
  { title: 'SUPORTE', items: [
    { label: 'Central de ajuda', href: '/dashboard/settings', mobilePage: 'help' },
  ] },
]

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

  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined

    import('@/lib/supabase/client').then(({ createSupabaseBrowserClient }) => {
      if (!active) return
      const db = createSupabaseBrowserClient()
      if (!db) return

      db.auth.getUser().then(({ data }) => {
        if (!active || !data.user) return
        setUser({
          name: data.user.user_metadata?.display_name || data.user.user_metadata?.full_name || data.user.email?.split('@')[0] || 'Usuário',
          email: data.user.email || '—',
        })
      })

      const { data: auth } = db.auth.onAuthStateChange((_event, session) => {
        if (!active) return
        if (!session?.user) {
          setUser({ name: 'Usuário', email: '—' })
          return
        }
        setUser({
          name: session.user.user_metadata?.display_name || session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Usuário',
          email: session.user.email || '—',
        })
      })
      unsubscribe = () => auth.subscription.unsubscribe()
    })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('althea-global-search', { detail: { query: query.trim() } }))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    setSearchOpen(false)
    setQuery('')
    setMenuOpen(false)
  }, [pathname])

  const selectTab = (tab: MobileShellTab) => onTabChange(tab)

  const navigateMenuItem = (item: MenuItem) => {
    if (item.mobilePage) {
      window.dispatchEvent(new CustomEvent('althea-mobile-page', { detail: item.mobilePage }))
      if (pathname !== '/dashboard') router.push('/dashboard')
      setMenuOpen(false)
      return
    }
    if (item.href && item.href !== pathname) router.push(item.href)
    setMenuOpen(false)
  }

  return (
    <div className="min-h-screen bg-[var(--althea-bg)] text-white antialiased">
      <header className="fixed inset-x-0 top-0 z-[100] h-[76px] border-b border-white/[0.06] bg-[rgba(11,11,13,0.97)] px-4 backdrop-blur-xl">
        <div className="mx-auto flex h-full w-full max-w-[1440px] items-center">
          <button type="button" onClick={() => selectTab('dashboard')} aria-label="Ir para o Dashboard" className="flex h-16 min-w-0 shrink items-center justify-start rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[rgba(29,184,84,0.4)]">
            <img src="/althea-logo-inner.PNG" alt="Althea Pay" className="h-14 w-auto max-w-[220px] object-contain drop-shadow-[0_0_22px_rgba(29,184,84,0.2)] sm:h-16 sm:max-w-[240px]" />
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button type="button" aria-label="Buscar" aria-expanded={searchOpen} onClick={() => setSearchOpen((value) => !value)} className={`grid h-11 w-11 place-items-center rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(29,184,84,0.4)] ${searchOpen ? 'bg-[rgba(29,184,84,0.08)] text-[var(--althea-brand)]' : 'text-[var(--althea-muted)] hover:bg-white/[0.03] hover:text-white'}`}>
              <Search size={25} strokeWidth={1.55} aria-hidden="true" />
            </button>
            <button type="button" aria-label="Abrir menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)} className={`grid h-11 w-11 place-items-center rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(29,184,84,0.4)] ${menuOpen ? 'bg-[rgba(29,184,84,0.08)] text-[var(--althea-brand)]' : 'text-[var(--althea-muted)] hover:bg-white/[0.03] hover:text-white'}`}>
              {menuOpen ? <X size={25} strokeWidth={1.55} aria-hidden="true" /> : <Menu size={25} strokeWidth={1.55} aria-hidden="true" />}
            </button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {searchOpen && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 42 }} exit={{ opacity: 0, height: 0 }} className="absolute left-0 right-0 top-[76px] border-b border-white/[0.04] bg-[rgba(11,11,13,0.98)] px-4 py-2 backdrop-blur-xl">
              <div className="mx-auto flex h-[42px] max-w-[1180px] items-center gap-2 rounded-xl border border-white/[0.04] bg-[var(--althea-surface)] px-3">
                <Search size={15} className="text-[var(--althea-muted)]" aria-hidden="true" />
                <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar..." aria-label="Pesquisar na plataforma" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[var(--althea-muted)]" />
                <button type="button" aria-label="Fechar pesquisa" onClick={() => { setQuery(''); setSearchOpen(false) }} className="grid h-9 w-9 place-items-center text-[var(--althea-muted)] hover:text-white"><X size={16} aria-hidden="true" /></button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </header>

      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.button aria-label="Fechar menu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMenuOpen(false)} className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm" />
            <motion.aside initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 320, damping: 32 }} className="fixed right-0 top-0 z-[120] flex h-full w-[min(390px,92vw)] flex-col border-l border-white/[0.08] bg-[rgba(8,12,10,0.98)] shadow-[-30px_0_80px_rgba(0,0,0,0.6)]">
              <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-5">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/[0.08] bg-white/[0.04] text-sm font-semibold text-white">{user.name.slice(0, 1).toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{user.name}</p>
                  <p className="truncate text-xs text-[var(--althea-muted)]">{user.email}</p>
                </div>
                <button type="button" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} className="grid h-10 w-10 place-items-center rounded-xl text-[var(--althea-muted)] hover:bg-white/[0.04] hover:text-white"><X size={20} /></button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-5 pb-8">
                <p className="mb-5 text-[11px] font-bold tracking-[0.22em] text-[var(--althea-brand)]">ALTHEA PAY</p>
                {menuSections.map((section) => (
                  <section key={section.title} className="mb-5">
                    <h2 className="mb-2 px-2 text-[10px] font-bold tracking-[0.18em] text-[var(--althea-muted)]">{section.title}</h2>
                    <div className="space-y-1">
                      {section.items.map((item) => {
                        const Icon = item.icon
                        const active = item.href ? tabIsActive(pathname, item.href) && !item.mobilePage : false
                        return <button key={`${section.title}-${item.label}`} type="button" onClick={() => navigateMenuItem(item)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${active ? 'bg-[rgba(29,184,84,0.08)] text-[var(--althea-brand)]' : 'text-white/80 hover:bg-white/[0.04] hover:text-white'}`}>
                          {Icon ? <Icon size={17} strokeWidth={1.7} aria-hidden="true" /> : <span className="h-[17px] w-[17px]" aria-hidden="true" />}
                          <span>{item.label}</span>
                        </button>
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main className="min-w-0 pt-[76px] pb-[128px] lg:pb-10">
        <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-5 lg:px-8">{children}</div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-[100] px-3 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 lg:hidden" aria-label="Navegação móvel">
        <div className="mx-auto grid h-[72px] w-full max-w-[760px] grid-cols-5 items-stretch gap-1 rounded-[36px] border border-white/[0.06] bg-[rgba(15,26,22,0.94)] p-1.5 shadow-[0_32px_64px_rgba(0,0,0,0.7)] backdrop-blur-xl">
          {bottomTabs.map(({ id, label, icon: Icon, href, mobilePage }) => (
            <Nav key={id} id={id} label={label} icon={Icon} active={mobilePage ? false : tabIsActive(pathname, href)} onClick={selectTab} mobile />
          ))}
        </div>
      </nav>
    </div>
  )
}

function Nav({ id, label, icon: Icon, active, onClick, mobile = false }: { id: MobileShellTab; label: string; icon: typeof LayoutDashboard; active: boolean; onClick: (tab: MobileShellTab) => void; mobile?: boolean }) {
  return <motion.button type="button" aria-current={active ? 'page' : undefined} aria-label={label} onClick={() => onClick(id)} whileTap={{ scale: 0.97 }} className={`group relative flex min-w-0 items-center justify-center rounded-[30px] transition-all duration-200 ${mobile ? 'h-full flex-col gap-1.5 px-1' : 'w-full justify-start gap-2 px-3 py-3'} ${active ? 'text-[var(--althea-brand)]' : 'text-[var(--althea-muted)] hover:text-white'}`}>
    <span aria-hidden="true" className={`absolute rounded-[30px] border transition-colors ${active ? 'inset-0 border-[rgba(29,184,84,0.2)] bg-[rgba(29,184,84,0.08)]' : 'inset-0 border-transparent group-hover:bg-white/[0.02]'}`} />
    <Icon className="relative z-10 shrink-0" size={mobile ? 24 : 19} strokeWidth={active ? 2 : 1.8} />
    <span className={`relative z-10 max-w-full truncate leading-none ${mobile ? 'px-1 text-[10px] font-medium sm:text-[11px]' : 'text-xs'}`}>{label}</span>
  </motion.button>
}
