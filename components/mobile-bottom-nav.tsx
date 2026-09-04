'use client'
import {CircleDollarSign,GitBranch,LayoutDashboard,Network,Settings} from 'lucide-react'
const items=[['Dashboard',LayoutDashboard],['Vendas',CircleDollarSign],['Funis & Chat',GitBranch],['Gateways & Roteamento',Network],['Configurações',Settings]] as const
export default function MobileBottomNav(){return <nav className="wl-mobile-bottom-nav" aria-label="Navegação móvel">{items.map(([label,Icon])=><button key={label} onClick={()=>{const buttons=Array.from(document.querySelectorAll<HTMLButtonElement>('.wl-sidebar nav button'));const target=buttons.find(b=>b.textContent?.includes(label));target?.click()}}><Icon/><span>{label==='Funis & Chat'?'Chat':label==='Gateways & Roteamento'?'Gatew':label==='Configurações'?'Config':label}</span></button>)}</nav>}
