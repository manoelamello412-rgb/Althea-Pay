'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Building2, FileKey2, Globe2, LayoutDashboard, MessageCircle, Network, Search, Settings, ShieldCheck, Sparkles, UserRound, Users, X } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'

export type MobileShellTab = 'dashboard' | 'gateways' | 'chat' | 'ia' | 'funil'

const tabs = [
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { id: 'gateways', label: 'Gateway', href: '/dashboard/gateways', icon: Network },
  { id: 'chat', label: 'Chat', href: '/dashboard/crm', icon: MessageCircle },
  { id: 'ia', label: 'IA', href: '/dashboard/ia', icon: Sparkles },
  { id: 'funil', label: 'Funil', href: '/dashboard/funil', icon: Globe2 },
] as const

const settingsItems = [
  { label: 'Meu Perfil', href: '/dashboard/settings/perfil', icon: UserRound },
  { label: 'Minha Empresa', href: '/dashboard/settings/empresa', icon: Building2 },
  { label: 'Segurança', href: '/dashboard/settings/seguranca', icon: ShieldCheck },
  { label: 'Desempenho', href: '/dashboard/settings/desempenho', icon: Sparkles },
  { label: 'Vendas', href: '/dashboard/settings/vendas', icon: Network },
  { label: 'Funil e Domínio', href: '/dashboard/settings/funil-dominio', icon: Globe2 },
  { label: 'Recuperação', href: '/dashboard/settings/recuperacao', icon: MessageCircle },
  { label: 'Usuários', href: '/dashboard/settings/usuarios', icon: Users },
  { label: 'Integrações', href: '/dashboard/settings/integracoes', icon: FileKey2 },
  { label: 'IA', href: '/dashboard/settings/iara', icon: Sparkles },
  { label: 'Gateways', href: '/dashboard/settings/gateways', icon: Network },
] as const

type Props = {
  activeTab: MobileShellTab
  onTabChange: (tab: MobileShellTab) => void
  children: ReactNode
}

function tabIsActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/dashboard/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function MobileShell({ activeTab, onTabChange, children }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('althea-global-search', { detail: { query: query.trim() } }))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    setSearchOpen(false)
    setSettingsOpen(false)
    setQuery('')
  }, [pathname])

  const go = (tab: MobileShellTab) => onTabChange(tab)

  return (
    <div className="min-h-screen bg-[var(--althea-bg)] text-white antialiased">
      <aside className="fixed inset-y-0 left-0 z-[80] hidden w-[250px] border-r border-white/[0.04] bg-[var(--althea-surface)] px-4 py-6 lg:flex lg:flex-col">
        <nav aria-label="Navegação principal" className="space-y-1 pt-2">
          {tabs.map(({ id, label, icon: Icon, href }) => (
            <Nav key={id} id={id} label={label} icon={Icon} active={tabIsActive(pathname, href)} onClick={go} />
          ))}
        </nav>
      </aside>

      <header className="fixed inset-x-0 top-0 z-[100] h-[76px] border-b border-white/[0.06] bg-[rgba(11,11,13,0.97)] px-4 backdrop-blur-xl lg:pl-[274px]">
        <div className="mx-auto flex h-full w-full max-w-[1180px] items-center">
          <button type="button" onClick={() => go('dashboard')} aria-label="Ir para o Dashboard" className="flex h-16 min-w-0 shrink items-center justify-start rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[rgba(29,187,84,0.4)]">
            <img src="/althea-logo-inner.PNG" alt="Althea Pay" className="h-14 w-auto max-w-[220px] object-contain drop-shadow-[0_0_22px_rgba(29,187,84,0.2)] sm:h-16 sm:max-w-[240px]" />
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button type="button" aria-label="Buscar" aria-expanded={searchOpen} onClick={() => setSearchOpen((value) => !value)} className={`grid h-11 w-11 place-items-center rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(29,187,84,0.4)] ${searchOpen ? 'bg-[rgba(29,187,84,0.08)] text-[var(--althea-brand)]' : 'text-[var(--althea-muted)] hover:bg-white/[0.03] hover:text-white'}`}>
              <Search size={25} strokeWidth={1.55} aria-hidden="true" />
            </button>
            <div className="relative">
              <button type="button" aria-label="Configurações" title="Configurações" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((value) => !value)} className={`grid h-11 w-11 place-items-center rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(29,187,84,0.4)] ${settingsOpen ? 'bg-[rgba(29,187,84,0.08)] text-[var(--althea-brand)]' : 'text-[var(--althea-muted)] hover:bg-white/[0.03] hover:text-white'}`}>
                <Settings size={25} strokeWidth={1.55} aria-hidden="true" />
              </button>
              <AnimatePresence>
                {settingsOpen && (
                  <motion.div initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }} className="absolute right-0 top-[52px] z-[120] w-[min(310px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-white/[0.06] bg-[rgba(15,26,22,0.98)] p-2 shadow-[0_32px_64px_rgba(0,0,0,0.7)] backdrop-blur-2xl">
                    <button type="button" onClick={() => { setSettingsOpen(false); router.push('/dashboard/settings') }} className="mb-1 flex w-full items-center gap-3 rounded-xl border border-[rgba(29,187,84,0.2)] bg-[rgba(29,187,84,0.08)] px-3 py-3 text-left">
                      <Settings size={17} className="text-[var(--althea-brand)]" aria-hidden="true" />
                      <span><strong className="block text-sm text-white">Central de Configuração</strong><small className="text-[10px] text-[var(--althea-muted)]">Abrir visão geral das configurações</small></span>
                    </button>
                    <div className="max-h-[min(520px,calc(100vh-120px))] overflow-y-auto pr-1">
                      {settingsItems.map(({ label, href, icon: Icon }) => (
                        <button key={href} type="button" onClick={() => { setSettingsOpen(false); router.push(href) }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-[var(--althea-muted)] transition hover:bg-white/[0.03] hover:text-white">
                          <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {searchOpen && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 42 }} exit={{ opacity: 0, height: 0 }} className="absolute left-0 right-0 top-[76px] border-b border-white/[0.04] bg-[rgba(11,11,13,0.98)] px-4 py-2 backdrop-blur-xl lg:pl-[274px]">
              <div className="mx-auto flex h-[42px] max-w-[1180px] items-center gap-2 rounded-xl border border-white/[0.04] bg-[var(--althea-surface)] px-3">
                <Search size={15} className="text-[var(--althea-muted)]" aria-hidden="true" />
                <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar..." aria-label="Pesquisar na plataforma" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[var(--althea-muted)]" />
                <button type="button" aria-label="Fechar pesquisa" onClick={() => { setQuery(''); setSearchOpen(false) }} className="grid h-9 w-9 place-items-center text-[var(--althea-muted)] hover:text-white"><X size={16} aria-hidden="true" /></button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main className="min-w-0 pt-[76px] pb-[104px] lg:pl-[250px] lg:pb-10">
        <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-5 lg:px-8">{children}</div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-[100] px-3 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 lg:hidden" aria-label="Navegação móvel">
        <div className="mx-auto grid h-[72px] w-full max-w-[760px] grid-cols-5 items-stretch gap-1 rounded-[36px] border border-white/[0.06] bg-[rgba(15,26,22,0.94)] p-1.5 shadow-[0_32px_64px_rgba(0,0,0,0.7)] backdrop-blur-xl">
          {tabs.map(({ id, label, icon: Icon, href }) => (
            <Nav key={id} id={id} label={label} icon={Icon} active={tabIsActive(pathname, href)} onClick={go} mobile />
          ))}
        </div>
      </nav>
    </div>
  )
}

function Nav({ id, label, icon: Icon, active, onClick, mobile = false }: {
  id: MobileShellTab
  label: string
  icon: typeof LayoutDashboard
  active: boolean
  onClick: (tab: MobileShellTab) => void
  mobile?: boolean
}) {
  return (
    <motion.button type="button" aria-current={active ? 'page' : undefined} aria-label={label} onClick={() => onClick(id)} whileTap={{ scale: 0.97 }} className={`group relative flex min-w-0 items-center justify-center rounded-[30px] transition-all duration-200 ${mobile ? 'h-full flex-col gap-1.5 px-1' : 'w-full justify-start gap-2 px-3 py-3'} ${active ? 'text-[var(--althea-brand)]' : 'text-[var(--althea-muted)] hover:text-white'}`}>
      <span aria-hidden="true" className={`absolute rounded-[30px] border transition-colors ${active ? 'inset-0 border-[rgba(29,187,84,0.2)] bg-[rgba(29,187,84,0.08)]' : 'inset-0 border-transparent group-hover:bg-white/[0.02]'}`} />
      <Icon className="relative z-10 shrink-0" size={mobile ? 24 : 19} strokeWidth={active ? 2 : 1.8} />
      <span className={`relative z-10 max-w-full truncate leading-none ${mobile ? 'px-1 text-[10px] font-medium sm:text-[11px]' : 'text-xs'}`}>{label}</span>
    </motion.button>
  )
}
