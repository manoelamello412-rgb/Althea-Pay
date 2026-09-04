'use client'

import { CreditCard, Filter, Search, X, ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'

const nav=[['dashboard','Dashboard'],['vendas','Vendas'],['funis','Funis/Chat'],['gateways','Gateways'],['configuracoes','Config.']] as const
const icon=(key:string)=>key==='dashboard'?'▦':key==='vendas'?'▤':key==='funis'?'♧':key==='gateways'?'◈':'⚙'

export default function SalesMobile(){
 const [query,setQuery]=useState('');const [filterOpen,setFilterOpen]=useState(false);const [periodOpen,setPeriodOpen]=useState(false);const [period,setPeriod]=useState('Todo o período');const [status,setStatus]=useState('Todas');const [active,setActive]=useState('vendas')
 useEffect(()=>{const h=(e:Event)=>setActive((e as CustomEvent<string>).detail||'dashboard');window.addEventListener('althea-mobile-page',h);return()=>window.removeEventListener('althea-mobile-page',h)},[])
 const go=(page:string)=>{setActive(page);window.dispatchEvent(new CustomEvent('althea-mobile-page',{detail:page}))}
 if(active!=='vendas') return null
 const clear=()=>{setQuery('');setPeriod('Todo o período');setStatus('Todas')}
 return <section className="althea-mobile-sales" aria-label="Vendas mobile">
  <header className="ams-header"><div className="ams-brand"><img src="/althea-logo.png" alt="Althea Pay"/></div><button className="ams-menu" type="button" aria-label="Mais opções">⋯</button></header>
  <main className="ams-content"><h1>Vendas</h1><p className="ams-subtitle">Transações</p>
   <label className="ams-search"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} type="search" placeholder="Buscar transações..." aria-label="Buscar transações..."/></label>
   <div className="ams-filters"><button className="ams-filter period" type="button" onClick={()=>setPeriodOpen(v=>!v)}><span>{period}</span><ChevronDown size={13}/></button><button className="ams-filter" type="button" onClick={()=>setFilterOpen(true)}><Filter size={13}/><span>Filtros</span></button></div>
   {periodOpen&&<div className="ams-inline-menu">{['Todo o período','Hoje','Últimos 7 dias','Últimos 30 dias'].map(item=><button key={item} type="button" className={period===item?'selected':''} onClick={()=>{setPeriod(item);setPeriodOpen(false)}}>{item}<span>{period===item?'✓':''}</span></button>)}</div>}
   <section className="ams-transactions"><div className="ams-table-head"><span>Cliente</span><span>Valor</span><span>Status</span></div><div className="ams-empty"><div className="ams-empty-icon"><CreditCard size={21}/></div><strong>Nenhuma transação encontrada</strong><p>Tente ajustar os filtros ou o período selecionado.</p><button type="button" onClick={clear}>Limpar filtros</button></div></section>
   <section className="ams-summary"><article><span>Total</span><strong>R$ 0,00</strong></article><article><span>Pagas</span><strong>0</strong></article><article><span>Pendentes</span><strong>0</strong></article></section>
  </main>
  <nav className="ams-bottom-nav" aria-label="Navegação principal">{nav.map(([key,label])=><button key={key} type="button" className={active===key?'active':''} onClick={()=>go(key)}><span>{icon(key)}</span><small>{label}</small></button>)}</nav>
  {filterOpen&&<div className="ams-modal" role="dialog" aria-modal="true" aria-label="Filtrar transações" onClick={e=>{if(e.currentTarget===e.target)setFilterOpen(false)}}><div className="ams-sheet"><div className="ams-handle"/><div className="ams-sheet-title"><h2>Filtrar transações</h2><button type="button" aria-label="Fechar" onClick={()=>setFilterOpen(false)}><X size={17}/></button></div>{['Todas','Pagas','Pendentes','Canceladas'].map(item=><button key={item} type="button" className={status===item?'selected':''} onClick={()=>setStatus(item)}><span>{item}</span><b>{status===item?'✓':'○'}</b></button>)}<button className="ams-apply" type="button" onClick={()=>setFilterOpen(false)}>Aplicar filtros</button></div></div>}
 </section>
}
