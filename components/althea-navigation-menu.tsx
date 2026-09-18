'use client'

import { useEffect, useState } from 'react'
import { BarChart3, CircleDollarSign, GitBranch, KeyRound, LayoutDashboard, LifeBuoy, LockKeyhole, Menu, Network, Plug, Settings, ShieldCheck, Users, Webhook, X, MessageCircle, CreditCard } from 'lucide-react'
import { useRouter } from 'next/navigation'

type MenuItem = readonly [string, string, typeof LayoutDashboard]
type MenuSection = { title: string; items: readonly MenuItem[] }

const sections: readonly MenuSection[] = [
  { title: 'OPERAR', items: [['Dashboard', '/dashboard', LayoutDashboard], ['Vendas', '/dashboard/vendas', CircleDollarSign]] },
  { title: 'RECEBER', items: [['Gateways', '/dashboard/gateways', Network], ['Pagamentos', '/dashboard/pagamentos', CreditCard]] },
  { title: 'VENDER', items: [['Funis', '/dashboard/funil', GitBranch], ['Checkouts', '/dashboard/checkouts', CreditCard]] },
  { title: 'RELACIONAR', items: [['Clientes', '/dashboard/clientes', Users], ['Chat / CRM', '/dashboard/crm', MessageCircle]] },
  { title: 'ANALISAR', items: [['Analytics', '/dashboard/analytics', BarChart3], ['IA', '/dashboard/ia', ShieldCheck]] },
  { title: 'INTEGRAÇÕES', items: [['Integration Hub', '/dashboard/integration-hub', Plug], ['API', '/dashboard/api', KeyRound], ['Webhooks', '/dashboard/webhooks', Webhook]] },
  { title: 'ADMINISTRAÇÃO', items: [['Configurações', '/dashboard/settings', Settings], ['Membros e acessos', '/dashboard/members', Users], ['Segurança', '/dashboard/security', LockKeyhole]] },
  { title: 'SUPORTE', items: [['Central de ajuda', '/dashboard/help', LifeBuoy]] },
]

export function AltheaNavigationMenu() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [user, setUser] = useState({ name: 'Usuário', email: '—' })

  useEffect(() => {
    let active = true
    import('@/lib/supabase/client').then(({ createSupabaseBrowserClient }) => {
      const db = createSupabaseBrowserClient()
      db?.auth.getUser().then(({ data }) => {
        if (!active || !data.user) return
        setUser({
          name: data.user.user_metadata?.display_name || data.user.user_metadata?.full_name || data.user.email?.split('@')[0] || 'Usuário',
          email: data.user.email || '—',
        })
      })
    })
    return () => { active = false }
  }, [])

  const navigate = (target: string) => {
    setOpen(false)
    router.push(target)
  }

  return (
    <>
      <button type="button" aria-label="Abrir menu principal" aria-expanded={open} onClick={() => setOpen(true)} className="grid h-11 w-11 place-items-center rounded-xl text-[var(--althea-muted)] transition hover:bg-white/[0.04] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(29,184,84,0.4)]">
        <Menu size={25} strokeWidth={1.7} aria-hidden="true" />
      </button>
      {open && (
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm" role="presentation" onMouseDown={() => setOpen(false)}>
          <aside role="dialog" aria-modal="true" aria-label="Menu principal" onMouseDown={(e) => e.stopPropagation()} className="h-full w-[min(88vw,360px)] overflow-y-auto border-r border-white/[0.08] bg-[rgba(7,12,10,0.98)] px-5 py-5 shadow-[24px_0_80px_rgba(0,0,0,0.6)]">
            <div className="mb-6 flex items-center justify-between">
              <div><p className="text-sm font-bold tracking-[0.16em] text-white">ALTHEA PAY</p><p className="mt-1 text-[11px] text-[var(--althea-muted)]">Painel operacional</p></div>
              <button type="button" aria-label="Fechar menu" onClick={() => setOpen(false)} className="grid h-10 w-10 place-items-center rounded-xl text-[var(--althea-muted)] hover:bg-white/[0.04] hover:text-white"><X size={20} /></button>
            </div>
            <div className="mb-6 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3">
              <div className="flex items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/[0.08] bg-white/[0.05] text-sm font-semibold text-white">{user.name.slice(0,1).toUpperCase()}</div><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{user.name}</p><p className="truncate text-xs text-[var(--althea-muted)]">{user.email}</p></div></div>
            </div>
            <nav className="space-y-5">
              {sections.map((section) => <section key={section.title}><p className="mb-2 px-2 text-[10px] font-semibold tracking-[0.16em] text-[var(--althea-muted)]">{section.title}</p><div className="space-y-1">{section.items.map(([label, target, Icon]) => <button key={label} type="button" onClick={() => navigate(target)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-white/80 transition hover:bg-white/[0.045] hover:text-white"><Icon size={17} strokeWidth={1.8} /><span>{label}</span></button>)}</div></section>)}
            </nav>
          </aside>
        </div>
      )}
    </>
  )
}

export default AltheaNavigationMenu
