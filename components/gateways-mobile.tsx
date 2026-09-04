'use client'

import { MoreHorizontal, Plus, Waypoints, X } from 'lucide-react'
import { useEffect, useState } from 'react'

const nav=[['dashboard','Dashboard'],['vendas','Vendas'],['funis','Funis'],['gateways','Gateway'],['configuracoes','Config']] as const
const icon=(key:string)=>key==='dashboard'?'⌂':key==='vendas'?'▥':key==='funis'?'▢':key==='gateways'?'◇':'⚙'

export default function GatewaysMobile(){
 const [active,setActive]=useState('gateways'),[addOpen,setAddOpen]=useState(false)
 useEffect(()=>{const h=(e:Event)=>setActive((e as CustomEvent<string>).detail||'dashboard');window.addEventListener('althea-mobile-page',h);return()=>window.removeEventListener('althea-mobile-page',h)},[])
 const go=(page:string)=>{setActive(page);window.dispatchEvent(new CustomEvent('althea-mobile-page',{detail:page}))}
 if(active!=='gateways') return null
 return <section className="althea-mobile-gateways" aria-label="Gateways mobile">
  <header className="amg-header"><div className="amg-brand"><img src="/althea-logo.png" alt="Althea Pay"/></div><button type="button" className="amg-menu" aria-label="Mais opções"><MoreHorizontal size={18}/></button></header>
  <main className="amg-content"><div className="amg-heading"><h1>Gateways</h1><p>Gerencie suas conexões de pagamento</p></div><button type="button" className="amg-add" onClick={()=>setAddOpen(true)}><Plus size={17}/><span>Adicionar Gateway</span></button>
   <article className="amg-card amg-empty animate-scale-up"><div className="amg-empty-icon"><Waypoints size={24}/></div><strong>Nenhum gateway cadastrado</strong><p>Você ainda não possui nenhum gateway de pagamento conectado.</p><p>Adicione seu primeiro gateway para começar.</p></article>
  </main><nav className="amg-bottom-nav" aria-label="Navegação principal">{nav.map(([key,label])=><button key={key} type="button" className={active===key?'active':''} onClick={()=>go(key)}><span>{icon(key)}</span><small>{label}</small></button>)}</nav>
  {addOpen&&<div className="amg-modal" role="dialog" aria-modal="true" aria-label="Adicionar Gateway" onClick={e=>{if(e.currentTarget===e.target)setAddOpen(false)}}><div className="amg-sheet"><div className="amg-handle"/><div className="amg-sheet-title"><div><span>CONFIGURAÇÃO</span><h2>Adicionar Gateway</h2></div><button type="button" onClick={()=>setAddOpen(false)} aria-label="Fechar"><X size={17}/></button></div><div className="amg-connect-intro"><Waypoints size={18}/><strong>Conexão de gateway</strong><p>Esta área está preparada para a conexão real do provedor. Nenhum gateway fictício é criado nesta etapa visual.</p></div><button type="button" className="amg-save" onClick={()=>setAddOpen(false)}>Fechar configuração</button></div></div>}
 </section>
}
