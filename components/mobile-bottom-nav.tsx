'use client'

import { usePathname, useRouter } from 'next/navigation'
import { GitBranch, LayoutGrid, MessageCircle, Network, Sparkles } from 'lucide-react'

const navItems = [
  { id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: LayoutGrid },
  { id: 'gateway', label: 'Gateway', path: '/dashboard/gateways', icon: Network },
  { id: 'chat', label: 'Chat', path: '/dashboard/crm', icon: MessageCircle },
  { id: 'ia', label: 'IA', path: '/dashboard/ia', icon: Sparkles },
  { id: 'funil', label: 'Funil', path: '/dashboard/funil', icon: GitBranch },
] as const

type TabId = (typeof navItems)[number]['id']

function isActivePath(pathname: string, path: string): boolean {
  if (path === '/dashboard') return pathname === '/dashboard' || pathname === '/dashboard/'
  return pathname === path || pathname.startsWith(`${path}/`)
}

export function MobileBottomNav() {
  const router = useRouter()
  const pathname = usePathname()

  const selectTab = (tab: TabId) => {
    const item = navItems.find((entry) => entry.id === tab)
    if (!item || pathname === item.path) return
    router.push(item.path)
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] px-3 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 sm:px-4">
      <nav aria-label="Navegação principal" className="pointer-events-auto mx-auto grid h-[72px] w-full max-w-[760px] grid-cols-5 items-stretch gap-1 rounded-[36px] border border-white/[0.06] bg-[rgba(15,26,22,0.94)] p-1.5 shadow-[0_32px_64px_rgba(0,0,0,0.7)] backdrop-blur-xl">
        {navItems.map((item) => {
          const isActive = isActivePath(pathname, item.path)
          const Icon = item.icon
          return (
            <button key={item.id} type="button" onClick={() => selectTab(item.id)} aria-current={isActive ? 'page' : undefined} aria-label={item.label} className={`group relative flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-[30px] px-1 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(29,187,84,0.4)] ${isActive ? 'text-[var(--althea-brand)]' : 'text-[var(--althea-muted)] hover:text-white'}`}>
              <span aria-hidden="true" className={`absolute inset-0 rounded-[30px] border ${isActive ? 'border-[rgba(29,187,84,0.2)] bg-[rgba(29,187,84,0.08)]' : 'border-transparent group-hover:bg-white/[0.02]'}`} />
              <Icon aria-hidden="true" className="relative z-10 h-6 w-6 shrink-0" strokeWidth={isActive ? 2 : 1.8} />
              <span className="relative z-10 max-w-full truncate px-1 text-[10px] font-medium leading-none sm:text-[11px]">{item.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

export default MobileBottomNav
