'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Activity, BarChart3, CreditCard, GitBranch, LayoutDashboard, LogOut, MessageSquare, Package, Plug, RefreshCw, Settings, ShieldCheck, ShoppingCart, Users, WalletCards, Webhook } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { FinancialCommandCenter, type CommandTx } from '@/components/financial-command-center'
import { AdvancedHub } from '@/components/advanced-hub'
import { hydrateAltheaBrand } from '@/components/brand-kit'

const money = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})
type Module = 'Visão geral'|'Transações'|'Checkouts'|'Reembolsos'|'Chargebacks'|'Funis'|'Produtos'|'Gateways'|'Roteamento'|'Métodos'|'Clientes'|'Chats'|'Analytics'|'Relatórios'|'Risco'|'APIs'|'Webhooks'|'Eventos'|'Logs'
const groups:{title:string;items:{label:Module;icon:typeof LayoutDashboard}[]}[]=[
 {title:'OPERAÇÃO',items:[{label:'Visão geral',icon:LayoutDashboard}]},
 {title:'VENDAS',items:[{label:'Transações',icon:ShoppingCart},{label:'Checkouts',icon:CreditCard},{label:'Reembolsos',icon:RefreshCw},{label:'Chargebacks',icon:ShieldCheck}]},
 {title:'INFRAESTRUTURA',items:[{label:'Funis',icon:GitBranch},{label:'Produtos',icon:Package},{label:'Gateways',icon:WalletCards},{label:'Roteamento',icon:GitBranch},{label:'Métodos',icon:CreditCard}]},
 {title:'RELACIONAMENTO',items:[{label:'Clientes',icon:Users},{label:'Chats',icon:MessageSquare}]},
 {title:'INTELIGÊNCIA',items:[{label:'Analytics',icon:BarChart3},{label:'Relatórios',icon:BarChart3},{label:'Risco',icon:ShieldCheck}]},
 {title:'INTEGRAÇÕES',items:[{label:'APIs',icon:Plug},{label:'Webhooks',icon:Webhook},{label:'Eventos',icon:Activity},{label:'Logs',icon:Activity}]},
]
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}
const approved=(s?:string|null)=>['approved','paid','completed','success','succeeded'].includes((s||'').toLowerCase())

export default function DashboardPage(){
 const router=useRouter(); const supabase=useMemo(()=>createSupabaseBrowserClient(),[])
 const [active,setActive]=useState<Module>('Visão geral'); const [uid,setUid]=useState(''); const [name,setName]=useState(''); const [tx,setTx]=useState<CommandTx[]>([]); const [counts,setCounts]=useState({gateways:0,funnels:0}); const [loading,setLoading]=useState(true); const [error,setError]=useState('')
 async function load(){
  if(!supabase){setError('Supabase não configurado.');setLoading(false);return}
  setLoading(true); const {data:{user}}=await supabase.auth.getUser(); if(!user){router.replace('/login');return}
  setUid(user.id); const profile=await supabase.from('profiles').select('display_name').eq('id',user.id).maybeSingle(); setName(String(profile.data?.display_name||user.user_metadata?.display_name||user.user_metadata?.full_name||''))
  const [s,g,f]=await Promise.all([
   supabase.from('sales').select('id,data,created_at,occurred_at,funnel_id,product_id,amount,currency,status,external_id,gateway_id,transaction_id').eq('user_id',user.id).order('created_at',{ascending:false}).limit(500),
   supabase.from('gateways').select('id').eq('user_id',user.id),
   supabase.from('funnels').select('id').eq('user_id',user.id).is('deleted_at',null)
  ])
  if(s.error)setError(s.error.message); if(g.error)setError(g.error.message); if(f.error)setError(f.error.message)
  setCounts({gateways:g.data?.length||0,funnels:f.data?.length||0})
  setTx((s.data||[]).map((x:Record<string,unknown>)=>{const d=obj(x.data);return {id:String(x.id),amount:x.amount==null?(d.amount==null?0:Number(d.amount)):Number(x.amount),status:x.status==null?String(d.status||''):String(x.status),currency:x.currency==null?String(d.currency||'BRL'):String(x.currency),created_at:String(x.occurred_at||x.created_at||''),gateway_id:x.gateway_id==null?String(d.gateway_id||''):String(x.gateway_id),funnel_id:x.funnel_id==null?String(d.funnel_id||''):String(x.funnel_id),product_id:x.product_id==null?String(d.product_id||''):String(x.product_id),external_id:x.external_id==null?String(d.external_id||''):String(x.external_id),transaction_id:x.transaction_id==null?String(d.transaction_id||''):String(x.transaction_id),customer:obj(d.customer)}}))
  setLoading(false)
 }
 useEffect(()=>{hydrateAltheaBrand();void load()},[])
 useEffect(()=>{if(!supabase||!uid)return;const channel=supabase.channel(`althea-command-${uid}`).on('postgres_changes',{event:'*',schema:'public',table:'sales',filter:`user_id=eq.${uid}`},()=>void load()).subscribe();return()=>{void supabase.removeChannel(channel)}},[supabase,uid])
 const stats=useMemo(()=>{const ok=tx.filter(x=>approved(x.status));const gross=tx.reduce((a,x)=>a+(Number(x.amount)||0),0);const revenue=ok.reduce((a,x)=>a+(Number(x.amount)||0),0);const fees=tx.reduce((a,x)=>a+(Number(obj(x.customer).fee)||0),0);return {gross,revenue,fees,net:revenue-fees,avg:ok.length?revenue/ok.length:0,approval:tx.length?ok.length/tx.length*100:0,pending:tx.filter(x=>['pending','created','processing'].includes((x.status||'').toLowerCase())).length,refunds:tx.filter(x=>(x.status||'').toLowerCase()==='refunded').length,chargebacks:tx.filter(x=>(x.status||'').toLowerCase()==='chargeback').length}},[tx])
 async function logout(){if(!supabase)return;await supabase.auth.signOut();router.replace('/login')}
 const commandModules:Module[]=['Visão geral','Transações','Checkouts','Reembolsos','Chargebacks','Funis','Gateways','Roteamento','Analytics','Risco','APIs','Webhooks','Eventos','Logs']
 return <div className="althea-app">
  <aside className="althea-sidebar"><div className="app-brand"><Image src="/althea-mark.png" alt="Althea Pay" width={38} height={44}/><div><b>ALTHEA</b><span>PAY</span></div></div><nav className="althea-nav">{groups.map(group=><div className="nav-group" key={group.title}><span>{group.title}</span>{group.items.map(item=>{const Icon=item.icon;return <button key={item.label} className={active===item.label?'active':''} onClick={()=>setActive(item.label)}><Icon size={16}/>{item.label}</button>})}</div>)}</nav><div className="sidebar-bottom"><button onClick={()=>router.push('/dashboard/settings')}><Settings size={16}/>Configurações</button><button onClick={logout}><LogOut size={16}/>Sair</button></div></aside>
  <main className="althea-main"><header className="althea-header"><div><span className="althea-kicker">ALTHEA PAY · COMMAND CENTER</span><h1>{active}</h1><p>{name?`Olá, ${name}. `:''}Controle financeiro, operação e infraestrutura em uma única superfície.</p></div><div className="dashboard-header-actions"><span className="althea-status"><i/>Operação protegida</span></div></header>
   {error&&<div className="fc-alert inline-alert"><div><b>Não foi possível carregar parte dos dados</b><span>{error}</span></div><button onClick={()=>void load()}><RefreshCw size={15}/> Tentar novamente</button></div>}
   {commandModules.includes(active) ? <><FinancialCommandCenter tx={tx} {...stats} loading={loading} onRefresh={()=>void load()}/><AdvancedHub/></> : <section className="fc-panel module-placeholder"><span className="fc-eyebrow">{active.toUpperCase()}</span><h2>{active}</h2><p>Este módulo usa o mesmo núcleo visual e operacional da central financeira. Seus registros estruturais ficam disponíveis aqui conforme a integração correspondente estiver configurada.</p><div className="placeholder-stats"><div><b>{counts.gateways}</b><span>Gateways</span></div><div><b>{counts.funnels}</b><span>Funis</span></div><div><b>{tx.length}</b><span>Transações</span></div><div><b>{money(stats.revenue)}</b><span>Receita</span></div></div></section>}
  </main>
 </div>
}
