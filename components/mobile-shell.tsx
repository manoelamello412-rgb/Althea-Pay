'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { LayoutDashboard, MessageCircle, Network, Search, Settings, Sparkles, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

export type MobileShellTab = 'dashboard' | 'gateways' | 'funis' | 'ia' | 'configuracoes'

const tabs = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'gateways', label: 'Gateway', icon: Network },
  { id: 'funis', label: 'Chat', icon: MessageCircle },
  { id: 'ia', label: 'IA', icon: Sparkles },
  { id: 'configuracoes', label: 'Configuração', icon: Settings },
] as const

const titles: Record<MobileShellTab, string> = {
  dashboard: 'DASHBOARD',
  gateways: 'GATEWAYS',
  funis: 'CHAT',
  ia: 'IA',
  configuracoes: 'CONFIGURAÇÃO',
}

type Props = { activeTab: MobileShellTab; onTabChange: (tab: MobileShellTab) => void; children: ReactNode }

export default function MobileShell({ activeTab, onTabChange, children }: Props) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('althea-global-search', { detail: { query: query.trim() } }))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    setSearchOpen(false)
    setQuery('')
  }, [activeTab])

  return (
    <div className="min-h-screen bg-[#020203] text-white antialiased">
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-[250px] border-r border-white/[0.07] bg-[#070908] px-4 py-6 lg:flex lg:flex-col">
        <button type="button" onClick={() => onTabChange('dashboard')} className="mb-8 flex items-center justify-center rounded-2xl border border-white/[0.06] bg-[#0a0d0b] p-4">
          <img src="/althea-logo.png" alt="ALTHEA PAY" className="h-12 w-auto object-contain" />
        </button>
        <div className="space-y-1">
          {tabs.map(({ id, label, icon: Icon }) => <Nav key={id} id={id} label={label} icon={Icon} active={activeTab === id} onClick={onTabChange} />)}
        </div>
      </aside>

      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#070908]/95 px-4 py-4 backdrop-blur-xl lg:ml-[250px]">
        <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3 lg:max-w-none">
          <button type="button" onClick={() => onTabChange('dashboard')} aria-label="Voltar ao Dashboard" className="flex min-w-0 items-center gap-3">
            <img src="/althea-logo.png" alt="ALTHEA PAY" className="h-8 w-auto max-w-[148px] object-contain" />
          </button>
          <div className="min-w-0 flex-1 text-center text-[14px] font-medium tracking-[0.08em] text-[#c8cfcb]">// {titles[activeTab]}</div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" aria-label="Pesquisar" onClick={() => setSearchOpen(v => !v)} className={`grid h-10 w-10 place-items-center rounded-xl border transition ${searchOpen ? 'border-[#1DB854]/50 bg-[#0d1a13] text-[#1DB854]' : 'border-white/[0.09] bg-[#0d0f0e] text-[#a8b0ac] hover:text-white'}`}><Search size={18}/></button>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {searchOpen && <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:42}} exit={{opacity:0,height:0}} className="mx-auto mt-3 flex max-w-xl items-center gap-2 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0b0d0c] px-3 lg:max-w-none"><Search size={15} className="text-[#66716c]"/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Pesquisar..." className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-[#66716c]"/><button type="button" aria-label="Fechar pesquisa" onClick={()=>{setQuery('');setSearchOpen(false)}} className="text-[#737d79]"><X size={15}/></button></motion.div>}
        </AnimatePresence>
      </header>

      <main className="lg:ml-[250px] pb-28 lg:pb-8">
        <div className="mx-auto w-full max-w-xl">{children}</div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-white/[0.10] bg-[#080a09]/96 px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-2xl lg:left-[250px]" aria-label="Navegação principal">
        <div className="mx-auto grid max-w-xl grid-cols-5 gap-1">
          {tabs.map(({ id, label, icon: Icon }) => <Nav key={id} id={id} label={label} icon={Icon} active={activeTab === id} onClick={onTabChange} mobile />)}
        </div>
      </nav>
    </div>
  )
}

function Nav({ id, label, icon: Icon, active, onClick, mobile = false }: { id: MobileShellTab; label: string; icon: typeof LayoutDashboard; active: boolean; onClick: (tab: MobileShellTab) => void; mobile?: boolean }) {
  return <motion.button type="button" aria-current={active?'page':undefined} aria-label={label} onClick={()=>onClick(id)} whileTap={{scale:.94}} className={`group relative flex items-center justify-center gap-2 rounded-xl transition ${mobile?'min-h-[58px] flex-col px-1 py-2':'w-full justify-start px-3 py-3'} ${active?'text-[#1DB854]':'text-[#7d8782] hover:text-white'}`}>
    {active && <span className={`absolute ${mobile?'inset-x-3 bottom-0 h-[2px]':'inset-y-2 left-0 w-[2px]'} rounded-full bg-[#1DB854]`}/>}<Icon size={mobile?22:19} strokeWidth={active?2:1.7}/><span className={mobile?'text-[10px] font-medium':'text-xs'}>{label}</span>
  </motion.button>
}
