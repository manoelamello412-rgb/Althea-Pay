'use client'

import { CreditCard, Filter, Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

export default function SalesMobile(){
 const [query,setQuery]=useState('')
 const [filterOpen,setFilterOpen]=useState(false)
 const [period,setPeriod]=useState('Todo o período')
 const [status,setStatus]=useState('Todas')
 const [active,setActive]=useState('vendas')
 const empty=true
 const periods=useMemo(()=>['Todo o período','Hoje','Últimos 7 dias','Últimos 30 dias'],[])
 useEffect(()=>{
  const handler=(event:Event)=>{const page=(event as CustomEvent<string>).detail;if(page) setActive(page)}
  window.addEventListener('althea-mobile-page',handler)
  return()=>window.removeEventListener('althea-mobile-page',handler)
 },[])
 const go=(page:string)=>{setActive(page);window.dispatchEvent(new CustomEvent('althea-mobile-page',{detail:page}))}
 if(active!=='vendas') return null
 return <section className="althea-mobile-sales" aria-label="Vendas mobile">
  <header className="ams-header"><div className="ams-brand"><img src="/althea-logo.png" alt="Althea Pay"/></div><button className="ams-menu" type="button" aria-label="Mais opções">⋯</button></header>
  <main className="ams-content">
   <h1>Vendas</h1><p className="ams-subtitle">Transações</p>
   <label className="ams-search"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} type="search" placeholder="Buscar transações..." aria-label="Buscar transações"/></label>
   <div className="ams-filters"><button className="ams-filter period" type="button" onClick={()=>setFilterOpen(true)}><span>{period}</span><SlidersHorizontal size={13}/></button><button className="ams-filter" type="button" onClick={()=>setFilterOpen(true)}><Filter size={13}/><span>Filtros</span></button></div>
   <section className="ams-transactions"><div className="ams-table-head"><span>Cliente</span><span>Valor</span><span>Status</span></div>{empty?<div className="ams-empty"><div className="ams-empty-icon"><CreditCard size={21}/></div><strong>Nenhuma transação encontrada</strong><p>Tente ajustar os filtros ou o período selecionado.</p><button type="button" onClick={()=>{setQuery('');setPeriod('Todo o período');setStatus('Todas')}}>Limpar filtros</button></div>:null}</section>
   <section className="ams-summary"><article><span>Total</span><strong>R$ 0,00</strong></article><article><span>Pagas</span><strong>0</strong></article><article><span>Pendentes</span><strong>0</strong></article></section>
  </main>
  <nav className="ams-bottom-nav" aria-label="Navegação principal">{[['dashboard','Dashboard'],['vendas','Vendas'],['funis','Funis/Chat'],['gateways','Gateways'],['configuracoes','Config.']].map(([key,label])=><button key={key} type="button" className={active===key?'active':''} onClick={()=>go(key)}><span>{key==='dashboard'?'▦':key==='vendas'?'▤':key==='funis'?'♧':key==='gateways'?'◈':'⚙'}</span><small>{label}</small></button>)}</nav>
  {filterOpen&&<div className="ams-modal" role="dialog" aria-modal="true" aria-label="Filtrar transações" onClick={e=>{if(e.currentTarget===e.target)setFilterOpen(false)}}><div className="ams-sheet"><div className="ams-handle"/><div className="ams-sheet-title"><h2>Filtrar transações</h2><button type="button" aria-label="Fechar" onClick={()=>setFilterOpen(false)}><X size={17}/></button></div>{['Todas','Pagas','Pendentes','Canceladas'].map(item=><button key={item} type="button" className={status===item?'selected':''} onClick={()=>setStatus(item)}><span>{item}</span><b>{status===item?'✓':'○'}</b></button>)}<div className="ams-period-title">Período</div>{periods.map(item=><button key={item} type="button" className={period===item?'selected':''} onClick={()=>setPeriod(item)}><span>{item}</span><b>{period===item?'✓':'○'}</b></button>)}<button className="ams-apply" type="button" onClick={()=>setFilterOpen(false)}>Aplicar filtros</button></div></div>}
 </section>
}
