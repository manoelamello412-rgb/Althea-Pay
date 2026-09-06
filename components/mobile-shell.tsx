'use client'
import { AnimatePresence, motion } from 'framer-motion'
import { Eye, EyeOff, Filter, LayoutDashboard, MessageCircle, Network, RefreshCw, Search, Settings, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export type MobileShellTab = 'dashboard' | 'gateways' | 'funis' | 'ia' | 'configuracoes'

const tabs = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'gateways', label: 'Gateway', icon: Network },
  { id: 'funis', label: 'Chat', icon: MessageCircle },
  { id: 'ia', label: 'IA', icon: Sparkles },
  { id: 'configuracoes', label: 'Configuração', icon: Settings },
] as const

type Props = { activeTab: MobileShellTab; onTabChange: (tab: MobileShellTab) => void; children: ReactNode }

export default function MobileShell({ activeTab, onTabChange, children }: Props) {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [name, setName] = useState('')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [showValues, setShowValues] = useState(true)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let alive = true
    void db.auth.getUser().then(({ data }) => {
      if (!alive) return
      const metadata = data.user?.user_metadata ?? {}
      const resolved = String(metadata.name ?? metadata.full_name ?? metadata.nome ?? data.user?.email?.split('@')[0] ?? '').trim()
      setName(resolved)
    })
    return () => { alive = false }
  }, [db])

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('althea-global-search', { detail: { query: query.trim() } }))
    }, 180)
    return () => window.clearTimeout(id)
  }, [query])

  const lastUpdate = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(now)

  const close = () => { setQuery(''); setOpen(false) }
  const toggleValues = () => {
    setShowValues((current) => !current)
    window.dispatchEvent(new CustomEvent('althea-privacy-toggle', { detail: { visible: !showValues } }))
  }
  const openFilter = () => window.dispatchEvent(new CustomEvent('althea-global-filter'))

  return (
    <div className="althea-shell min-h-screen">
      <aside className="althea-glass-sidebar">
        <button className="althea-shell-brand" type="button" aria-label="Voltar ao Dashboard" onClick={() => onTabChange('dashboard')}>
          <img src="/althea-logo-inner.png" alt="ALTHEA PAY" />
        </button>
        <div className="althea-sidebar-nav">
          {tabs.map(({ id, label, icon: Icon }) => <Nav key={id} id={id} label={label} icon={Icon} active={activeTab === id} onClick={onTabChange} />)}
        </div>
      </aside>

      <header className="althea-mobile-global-header">
        <div className="althea-mobile-global-topline">
          <button className="althea-mobile-global-brand" type="button" aria-label="Voltar ao Dashboard" onClick={() => onTabChange('dashboard')}>
            <img src="/althea-logo-inner.png" alt="ALTHEA PAY" />
          </button>
          <div className="althea-mobile-global-actions">
            <motion.button type="button" aria-label={showValues ? 'Ocultar valores' : 'Mostrar valores'} className="althea-mobile-global-icon" onClick={toggleValues} whileTap={{ scale: .9 }}>
              {showValues ? <Eye size={18} /> : <EyeOff size={18} />}
            </motion.button>
            <motion.button type="button" aria-label="Filtrar" className="althea-mobile-global-icon" onClick={openFilter} whileTap={{ scale: .9 }}>
              <Filter size={18} />
            </motion.button>
            {!open && <motion.button type="button" aria-label="Buscar" className="althea-mobile-global-icon" onClick={() => setOpen(true)} whileTap={{ scale: .9 }}><Search size={18} /></motion.button>}
            <motion.button type="button" aria-label="Atualizar tela" className="althea-mobile-global-icon" onClick={() => window.dispatchEvent(new CustomEvent('althea-refresh'))} whileTap={{ scale: .9 }}><RefreshCw size={17} /></motion.button>
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {open ? (
            <motion.div key="search" className="althea-mobile-global-search-wrap" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ type: 'spring', stiffness: 420, damping: 28 }}>
              <Search size={16} />
              <input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar na ALTHEA PAY..." aria-label="Buscar na ALTHEA PAY" />
              <button type="button" className="althea-mobile-global-search-close" onClick={close} aria-label="Fechar busca"><X size={16} /></button>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="althea-mobile-global-context">
          <strong>Olá, {name || 'usuário'} 👋</strong>
          <span>Aqui está o resumo geral da sua operação.</span>
          <small>• Última atualização: {lastUpdate}</small>
        </div>
      </header>

      <main className="althea-shell-main pb-32 md:pb-8">
        <div className="althea-bento-stage">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={activeTab} className="althea-screen-transition" initial={{ opacity: 0, x: 18, scale: .985 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: -18, scale: .985 }} transition={{ type: 'spring', stiffness: 360, damping: 30, mass: .72 }}>
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <nav className="althea-mobile-nav" aria-label="Navegação principal">
        {tabs.map(({ id, label, icon: Icon }) => <Nav key={id} id={id} label={label} icon={Icon} active={activeTab === id} onClick={onTabChange} mobile />)}
      </nav>
    </div>
  )
}

function Nav({ id, label, icon: Icon, active, onClick, mobile = false }: { id: MobileShellTab; label: string; icon: typeof LayoutDashboard; active: boolean; onClick: (tab: MobileShellTab) => void; mobile?: boolean }) {
  return (
    <motion.button type="button" className={`althea-shell-nav-button${active ? ' active' : ''}${mobile ? ' mobile' : ''}`} aria-current={active ? 'page' : undefined} aria-label={label} onClick={() => onClick(id)} whileHover={{ x: mobile ? 0 : 3, scale: 1.035 }} whileTap={{ scale: .94 }} transition={{ type: 'spring', stiffness: 520, damping: 24, mass: .55 }}>
      <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
      <span>{label}</span>
    </motion.button>
  )
}
