'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Activity, BarChart3, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, CreditCard, DollarSign, LayoutDashboard, LogOut, MessageSquare, Search, Settings, ShoppingCart, WalletCards, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Module = 'Dashboard' | 'Vendas' | 'Chat' | 'Gateways' | 'Config'
type Tx = { id: string; amount: number; status: string; currency: string; created_at: string; gateway_id?: string | null; funnel_id?: string | null; external_id?: string | null; customer?: Record<string, unknown> }
type Range = { from: Date; to: Date }

const nav: { label: Module; icon: typeof LayoutDashboard }[] = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Vendas', icon: ShoppingCart },
  { label: 'Chat', icon: MessageSquare },
  { label: 'Gateways', icon: WalletCards },
  { label: 'Config', icon: Settings },
]
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const emptySales = 'Nenhuma transação encontrada. As vendas aparecerão aqui em tempo real assim que seus funis receberem pagamentos.'
const emptyChat = 'Nenhum chat ativo no momento. Quando um cliente interagir em um dos seus funis, o suporte white-label correspondente aparecerá aqui instantaneamente.'

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }
function isoDate(d: Date) { return d.toISOString().slice(0, 10) }
function formatDate(d: Date) { return d.toLocaleDateString('pt-BR') }
function statusOk(s: string) { return ['approved', 'paid', 'completed', 'success', 'succeeded'].includes(s.toLowerCase()) }
function statusText(s: string) { const v=s.toLowerCase(); if(statusOk(s)) return 'Aprovada'; if(['pending','created','processing'].includes(v)) return 'Pendente'; if(v==='refunded') return 'Reembolsada'; if(v==='chargeback') return 'Chargeback'; return s || '—' }

function CalendarPicker({ value, onApply, onClose }: { value: Range; onApply: (r: Range) => void; onClose: () => void }) {
  const [cursor, setCursor] = useState(new Date(value.from.getFullYear(), value.from.getMonth(), 1))
  const [from, setFrom] = useState(value.from)
  const [to, setTo] = useState(value.to)
  const [selectingEnd, setSelectingEnd] = useState(false)
  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const start = new Date(first); start.setDate(1 - first.getDay())
    return Array.from({ length: 42 }, (_, i) => { const d=new Date(start); d.setDate(start.getDate()+i); return d })
  }, [cursor])
  function pick(d: Date) {
    if (!selectingEnd) { setFrom(startOfDay(d)); setTo(endOfDay(d)); setSelectingEnd(true); return }
    if (d < from) { setFrom(startOfDay(d)); setTo(endOfDay(from)) } else setTo(endOfDay(d))
    setSelectingEnd(false)
  }
  function preset(kind: string) {
    const today=startOfDay(new Date()); let a=today,b=endOfDay(today)
    if(kind==='Ontem'){a=new Date(today);a.setDate(a.getDate()-1);b=endOfDay(a)}
    if(kind==='7'){a=new Date(today);a.setDate(a.getDate()-6)}
    if(kind==='30'){a=new Date(today);a.setDate(a.getDate()-29)}
    if(kind==='month'){a=new Date(today.getFullYear(),today.getMonth(),1)}
    setFrom(a);setTo(b);setSelectingEnd(false)
  }
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal althea-card date-picker" onMouseDown={e=>e.stopPropagation()}>
      <div className="panel-heading"><div><strong>Selecionar período</strong><small>{formatDate(from)} — {formatDate(to)}</small></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={18}/></button></div>
      <div className="date-presets">{[['Hoje','today'],['Ontem','Ontem'],['Últimos 7 dias','7'],['Últimos 30 dias','30'],['Este mês','month']].map(([label,key])=><button key={key} onClick={()=>preset(key)}>{label}</button>)}</div>
      <div className="calendar-head"><button className="icon-button" onClick={()=>setCursor(new Date(cursor.getFullYear(),cursor.getMonth()-1,1))}><ChevronLeft size={18}/></button><strong>{cursor.toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</strong><button className="icon-button" onClick={()=>setCursor(new Date(cursor.getFullYear(),cursor.getMonth()+1,1))}><ChevronRight size={18}/></button></div>
      <div className="calendar-grid weekdays">{['D','S','T','Q','Q','S','S'].map((x,i)=><span key={i}>{x}</span>)}</div>
      <div className="calendar-grid">{days.map(d=>{const outside=d.getMonth()!==cursor.getMonth();const inside=d>=startOfDay(from)&&d<=endOfDay(to);return <button key={isoDate(d)} className={`${outside?'outside ':''}${inside?'selected':''}`} onClick={()=>pick(d)}>{d.getDate()}</button>})}</div>
      <div className="date-actions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" onClick={()=>{onApply({from,to});onClose()}}>Aplicar período</button></div>
    </div>
  </div>
}

export default function DashboardPage() {
  const router=useRouter(); const supabase=useMemo(()=>createSupabaseBrowserClient(),[])
  const [active,setActive]=useState<Module>('Dashboard'); const [tx,setTx]=useState<Tx[]>([]); const [gateways,setGateways]=useState<Record<string,unknown>[]>([]); const [chats,setChats]=useState<Record<string,unknown>[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState(''); const [search,setSearch]=useState(''); const [showCalendar,setShowCalendar]=useState(false)
  const [range,setRange]=useState<Range>(()=>{const t=startOfDay(new Date());const f=new Date(t);f.setDate(f.getDate()-6);return {from:f,to:endOfDay(t)}})
  const [userName,setUserName]=useState('')

  async function load() {
    if(!supabase)return; setLoading(true);setError(''); const {data:{user}}=await supabase.auth.getUser(); if(!user){router.replace('/login');return} setUserName(String(user.user_metadata?.display_name||user.user_metadata?.full_name||''))
    const [s,g,c]=await Promise.all([
      supabase.from('sales').select('id,amount,currency,status,created_at,occurred_at,gateway_id,funnel_id,external_id,data').eq('user_id',user.id).order('created_at',{ascending:false}).limit(500),
      supabase.from('gateways').select('id,data,created_at').eq('user_id',user.id).order('created_at',{ascending:false}),
      supabase.from('chats').select('id,data,created_at').eq('user_id',user.id).order('created_at',{ascending:false}),
    ])
    if(s.error||g.error||c.error){setError((s.error||g.error||c.error)?.message||'Não foi possível carregar os dados.');setLoading(false);return}
    setTx((s.data||[]).map((x:Record<string,unknown>)=>{const d=x.data&&typeof x.data==='object'&&!Array.isArray(x.data)?x.data as Record<string,unknown>:{};return {id:String(x.id),amount:Number(x.amount??d.amount??0),currency:String(x.currency??d.currency??'BRL'),status:String(x.status??d.status??''),created_at:String(x.occurred_at??x.created_at??''),gateway_id:x.gateway_id?String(x.gateway_id):null,funnel_id:x.funnel_id?String(x.funnel_id):null,external_id:x.external_id?String(x.external_id):null,customer:d.customer&&typeof d.customer==='object'?d.customer as Record<string,unknown>:undefined}}))
    setGateways((g.data||[]) as Record<string,unknown>[]);setChats((c.data||[]) as Record<string,unknown>[]);setLoading(false)
  }
  useEffect(()=>{load()},[])
  useEffect(()=>{if(!supabase)return;const channel=supabase.channel('althea-live').on('postgres_changes',{event:'*',schema:'public',table:'sales'},load).on('postgres_changes',{event:'*',schema:'public',table:'gateways'},load).on('postgres_changes',{event:'*',schema:'public',table:'chats'},load).subscribe();return()=>{supabase.removeChannel(channel)}},[supabase])

  const filtered=useMemo(()=>tx.filter(t=>{const d=new Date(t.created_at);const q=search.toLowerCase();return d>=range.from&&d<=range.to&&(!q||[t.id,t.status,t.gateway_id,t.funnel_id,t.external_id].some(v=>String(v||'').toLowerCase().includes(q)))}),[tx,range,search])
  const approved=filtered.filter(t=>statusOk(t.status)); const revenue=approved.reduce((a,t)=>a+t.amount,0); const approval=filtered.length?approved.length/filtered.length*100:0

  async function logout(){await supabase?.auth.signOut();router.replace('/login');router.refresh()}
  return <div className="althea-shell">
    <aside className="althea-sidebar"><div className="brand-lockup"><div className="brand-mark">✦</div><div><strong>ALTHEA</strong><small>PAY</small></div></div><nav>{nav.map(item=><button key={item.label} className={active===item.label?'active':''} onClick={()=>setActive(item.label)}><item.icon size={18}/><span>{item.label}</span></button>)}</nav><button className="sidebar-logout" onClick={logout}><LogOut size={18}/>Sair</button></aside>
    <main className="althea-main"><header className="althea-header"><div><span className="eyebrow">ALTHEA PAY · CONTROL CENTER</span><h1>{active}</h1><p>{userName?`Olá, ${userName}. `:''}Operação financeira conectada aos dados reais.</p></div><div className="master-search"><Search size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar transação, ID ou gateway..."/><button className="period-control" onClick={()=>setShowCalendar(true)}><CalendarDays size={17}/>{formatDate(range.from)} — {formatDate(range.to)}</button></div></header>
      {error&&<div className="alert danger">{error}</div>}
      {loading?<div className="althea-card empty-state"><Activity/><strong>Carregando dados reais...</strong></div>:
      active==='Dashboard'?<>
        <section className="dashboard-kpis"><article className="kpi-card althea-card"><span>FATURAMENTO</span><strong>{money.format(revenue)}</strong></article><article className="kpi-card althea-card"><span>TRANSAÇÕES</span><strong>{filtered.length}</strong></article><article className="kpi-card althea-card"><span>APROVAÇÃO</span><strong>{approval.toFixed(1)}%</strong></article><article className="kpi-card althea-card"><span>TICKET MÉDIO</span><strong>{approved.length?money.format(revenue/approved.length):money.format(0)}</strong></article></section>
        <section className="finance-chart-grid"><article className="althea-card chart-panel"><div className="panel-heading"><div><strong>Receita no período</strong><small>Somente transações aprovadas</small></div></div>{approved.length?<div className="record-list">{approved.slice(0,12).map(t=><div className="record" key={t.id}><div><strong>{t.external_id||t.id}</strong><small>{new Date(t.created_at).toLocaleString('pt-BR')}</small></div><span>{money.format(t.amount)}</span></div>)}</div>:<div className="empty-state compact"><BarChart3/><strong>{emptySales}</strong></div>}</article><article className="althea-card chart-panel"><div className="panel-heading"><div><strong>Métodos e gateways</strong><small>Configurações reais cadastradas</small></div></div>{gateways.length?<div className="record-list">{gateways.map(g=>{const d=g.data&&typeof g.data==='object'?g.data as Record<string,unknown>:{};return <div className="record" key={String(g.id)}><div><strong>{String(d.name||d.provider||g.id)}</strong><small>{String(d.status||'Configurado')}</small></div><CheckCircle2 size={17}/></div>})}</div>:<div className="empty-state compact"><WalletCards/><strong>Nenhum gateway configurado.</strong><small>Adicione um provedor real para começar a processar pagamentos.</small></div>}</article></section>
      </>:active==='Vendas'?<section className="althea-card"><div className="panel-heading"><div><strong>Transações</strong><small>{filtered.length} encontradas no período selecionado</small></div></div>{filtered.length?<div className="record-list">{filtered.map(t=><div className="record" key={t.id}><div><strong>{t.external_id||t.id}</strong><small>{new Date(t.created_at).toLocaleString('pt-BR')} · {t.gateway_id||'Gateway não identificado'}</small></div><span>{money.format(t.amount)} · {statusText(t.status)}</span></div>)}</div>:<div className="empty-state"><ShoppingCart/><strong>{emptySales}</strong></div>}</section>
      :active==='Chat'?<section className="operations-grid"><article className="althea-card chat-list"><div className="panel-heading"><div><strong>Chats ativos</strong><small>Atendimento white-label</small></div></div>{chats.length?chats.map(c=><div className="record" key={String(c.id)}><div><strong>Conversa {String(c.id).slice(0,8)}</strong><small>Registro real do funil</small></div><MessageSquare size={17}/></div>):<div className="empty-state compact"><MessageSquare/><strong>{emptyChat}</strong></div>}</article><article className="althea-card chat-thread"><div className="empty-state"><MessageSquare/><strong>Selecione uma conversa</strong><small>O histórico aparecerá aqui quando houver atendimento real.</small></div></article></section>
      :active==='Gateways'?<section className="althea-card"><div className="panel-heading"><div><strong>Gateways</strong><small>Infraestrutura cadastrada nesta conta</small></div><button className="primary" onClick={()=>router.push('/dashboard/settings')}>Adicionar novo gateway</button></div>{gateways.length?<div className="record-list">{gateways.map(g=>{const d=g.data&&typeof g.data==='object'?g.data as Record<string,unknown>:{};return <div className="record" key={String(g.id)}><div><strong>{String(d.name||d.provider||g.id)}</strong><small>Credencial e configuração armazenadas na conta</small></div><CreditCard size={18}/></div>})}</div>:<div className="empty-state"><WalletCards/><strong>Nenhum gateway configurado.</strong><small>Nenhum provedor fictício é exibido. Cadastre um gateway real para ele aparecer aqui.</small></div>}</section>
      :<section className="althea-card settings-tabs"><div className="panel-heading"><div><strong>Configurações</strong><small>Conta, financeiro, checkout, integrações e segurança.</small></div></div><div className="settings-grid"><button onClick={()=>router.push('/dashboard/settings')}>Conta & Equipe</button><button onClick={()=>router.push('/dashboard/settings')}>Financeiro</button><button onClick={()=>router.push('/dashboard/settings')}>Checkout & Domínios</button><button onClick={()=>router.push('/dashboard/settings')}>Segurança & Auditoria</button></div></section>}
    </main>
    <nav className="althea-mobile-nav">{nav.map(item=><button key={item.label} className={active===item.label?'active':''} onClick={()=>setActive(item.label)}><item.icon size={18}/><span>{item.label}</span></button>)}</nav>
    {showCalendar&&<CalendarPicker value={range} onApply={setRange} onClose={()=>setShowCalendar(false)}/>} 
  </div>
}
