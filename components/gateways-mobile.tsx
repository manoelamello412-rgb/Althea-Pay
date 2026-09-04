'use client'

import { ChevronDown, MoreHorizontal, Plus, Power, Trash2, Waypoints } from 'lucide-react'
import { useEffect, useState } from 'react'

type Gateway = { id:string; name:string; provider:string; status:'active'|'inactive'; environment:string; currency:string; priority:number }

const nav=[['dashboard','Dashboard'],['vendas','Vendas'],['funis','Funis'],['gateways','Gateway'],['configuracoes','Config']] as const
const icon=(key:string)=>key==='dashboard'?'⌂':key==='vendas'?'▥':key==='funis'?'▢':key==='gateways'?'◇':'⚙'

export default function GatewaysMobile(){
 const [active,setActive]=useState('gateways')
 const [gateway,setGateway]=useState<Gateway|null>(null)
 const [menuOpen,setMenuOpen]=useState(false)
 const [addOpen,setAddOpen]=useState(false)
 const [name,setName]=useState('')
 const [provider,setProvider]=useState('')

 useEffect(()=>{
  const h=(e:Event)=>setActive((e as CustomEvent<string>).detail||'dashboard')
  window.addEventListener('althea-mobile-page',h)
  return()=>window.removeEventListener('althea-mobile-page',h)
 },[])
 const go=(page:string)=>{setActive(page);window.dispatchEvent(new CustomEvent('althea-mobile-page',{detail:page}))}
 if(active!=='gateways') return null
 const addGateway=()=>{
  if(!name.trim()||!provider.trim()) return
  setGateway({id:`GTW-${Date.now().toString().slice(-6)}`,name:name.trim(),provider:provider.trim(),status:'active',environment:'Produção',currency:'BRL',priority:1})
  setName('');setProvider('');setAddOpen(false)
 }
 return <section className="althea-mobile-gateways" aria-label="Gateways mobile">
  <header className="amg-header"><div className="amg-brand"><span className="amg-mark">🌿</span><span>ALTHEA PAY</span></div><button type="button" className="amg-menu" aria-label="Mais opções"><MoreHorizontal size={18}/></button></header>
  <main className="amg-content">
   <div className="amg-heading"><h1>Gateways</h1><p>Gerencie suas conexões de pagamento</p></div>
   <button type="button" className="amg-add" onClick={()=>setAddOpen(true)}><Plus size={17}/><span>Adicionar Gateway</span></button>
   {gateway ? <article className="amg-card">
    <div className="amg-card-top"><div className="amg-gateway-title"><div className="amg-gateway-icon"><Waypoints size={18}/></div><div><strong>{gateway.name}</strong><span><i/> Ativo</span></div></div><button type="button" className="amg-more" aria-label="Opções do gateway" onClick={()=>setMenuOpen(v=>!v)}><MoreHorizontal size={18}/></button></div>
    <div className="amg-provider">{gateway.provider}</div>
    <div className="amg-divider"/>
    <div className="amg-meta"><div><span>Ambiente</span><strong>{gateway.environment}</strong></div><div><span>Moeda</span><strong>{gateway.currency}</strong></div><div><span>Prioridade</span><strong>{gateway.priority}</strong></div></div>
    <div className="amg-actions"><button type="button" onClick={()=>setGateway({...gateway,status:gateway.status==='active'?'inactive':'active'})}><Power size={13}/>{gateway.status==='active'?'Desativar':'Ativar'}</button><button type="button" className="danger" onClick={()=>{setGateway(null);setMenuOpen(false)}}><Trash2 size={13}/>Excluir</button></div>
    {menuOpen&&<div className="amg-card-menu"><button type="button" onClick={()=>setGateway({...gateway,status:gateway.status==='active'?'inactive':'active'})}><Power size={14}/>{gateway.status==='active'?'Desativar gateway':'Ativar gateway'}</button><button type="button" className="danger" onClick={()=>{setGateway(null);setMenuOpen(false)}}><Trash2 size={14}/>Excluir gateway</button></div>}
   </article> : <article className="amg-card amg-empty"><div className="amg-empty-icon"><Waypoints size={24}/></div><strong>Nenhum gateway cadastrado</strong><p>Você ainda não possui nenhum gateway de pagamento conectado.</p><p>Adicione seu primeiro gateway para começar.</p></article>}
  </main>
  <nav className="amg-bottom-nav" aria-label="Navegação principal">{nav.map(([key,label])=><button key={key} type="button" className={active===key?'active':''} onClick={()=>go(key)}><span>{icon(key)}</span><small>{label}</small></button>)}</nav>
  {addOpen&&<div className="amg-modal" role="dialog" aria-modal="true" aria-label="Adicionar Gateway" onClick={e=>{if(e.currentTarget===e.target)setAddOpen(false)}}><div className="amg-sheet"><div className="amg-handle"/><div className="amg-sheet-title"><div><span>CONFIGURAÇÃO</span><h2>Adicionar Gateway</h2></div><button type="button" onClick={()=>setAddOpen(false)} aria-label="Fechar">×</button></div><label>Nome do gateway<input value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Meu Gateway"/></label><label>Provedor<input value={provider} onChange={e=>setProvider(e.target.value)} placeholder="Ex.: Stripe"/></label><button type="button" className="amg-save" onClick={addGateway}>Adicionar Gateway</button></div></div>}
 </section>
}
