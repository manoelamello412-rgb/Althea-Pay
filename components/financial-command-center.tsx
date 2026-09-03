'use client'

import { useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Check, ChevronRight, Clock3, CreditCard, GitBranch, KeyRound, LockKeyhole, Network, RefreshCw, RotateCcw, Search, ShieldAlert, ShieldCheck, SlidersHorizontal, Users, Webhook, X } from 'lucide-react'

export type CommandTx = {
  id: string
  amount: number | null
  status: string | null
  currency?: string | null
  created_at?: string
  gateway_id?: string | null
  funnel_id?: string | null
  product_id?: string | null
  customer?: Record<string, unknown> | null
  external_id?: string | null
  transaction_id?: string | null
}

type Props = {
  tx: CommandTx[]
  revenue: number
  gross: number
  net: number
  fees: number
  avg: number
  approval: number
  pending: number
  refunds: number
  chargebacks: number
  loading?: boolean
  onRefresh?: () => void
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const money = (v: number) => brl.format(v || 0)
const status = (v?: string | null) => {
  const s = (v || '').toLowerCase()
  if (['approved','paid','completed','success','succeeded'].includes(s)) return 'Approved'
  if (['pending','created','processing'].includes(s)) return 'Processing'
  if (s === 'refunded') return 'Refunded'
  return 'Declined'
}
const customerName = (c?: Record<string, unknown> | null) => String(c?.name || c?.full_name || c?.email || 'Cliente')

function spark(seed: number) { return Array.from({ length: 9 }, (_, i) => ({ i, v: Math.max(1, seed + Math.sin(i * 1.7) * seed * .12 + i * seed * .018) })) }
function Metric({ label, value, delta, positive = true, seed }: { label: string; value: string; delta: string; positive?: boolean; seed: number }) {
  const data = spark(seed)
  return <article className="fc-metric">
    <div className="fc-metric-head"><span>{label}</span><span className={positive ? 'fc-delta up' : 'fc-delta down'}>{positive ? <ArrowUpRight size={12}/> : <ArrowDownRight size={12}/>} {delta}</span></div>
    <strong>{value}</strong>
    <ResponsiveContainer width="100%" height={35}><AreaChart data={data}><Area type="monotone" dataKey="v" stroke="var(--althea-green)" fill="var(--althea-green)" fillOpacity={.1} strokeWidth={1.6}/></AreaChart></ResponsiveContainer>
  </article>
}

export function FinancialCommandCenter({ tx, revenue, gross, net, fees, avg, approval, pending, refunds, chargebacks, loading, onRefresh }: Props) {
  const [chart, setChart] = useState<'revenue'|'approval'|'risk'>('revenue')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<CommandTx | null>(null)
  const [refundBusy, setRefundBusy] = useState(false)
  const [refundDone, setRefundDone] = useState(false)
  const [criticalOpen, setCriticalOpen] = useState(true)
  const pageSize = 8

  const filtered = useMemo(() => tx.filter(t => {
    const s = status(t.status)
    const q = search.trim().toLowerCase()
    const text = [t.id, t.gateway_id, t.external_id, t.transaction_id, t.funnel_id, t.product_id, customerName(t.customer)].join(' ').toLowerCase()
    return (!q || text.includes(q)) && (filter === 'All' || s === filter)
  }), [tx, search, filter])
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)
  const chartData = useMemo(() => Array.from({length: 12}, (_, i) => ({ name: `${i + 1}`, revenue: Math.max(0, revenue / 12 * (0.72 + i / 26 + Math.sin(i) * .08)), approved: Math.round(approval + Math.sin(i * .8) * 4), declined: Math.max(1, Math.round(100 - approval - Math.sin(i * .8) * 4)), risk: Math.max(.3, chargebacks + Math.sin(i * 1.1) * .8), limit: Math.max(1, chargebacks + 1.4) })), [revenue, approval, chargebacks])

  async function quickRefund() {
    if (!selected || refundBusy || refundDone) return
    setRefundBusy(true)
    await new Promise(r => setTimeout(r, 650))
    setRefundBusy(false); setRefundDone(true)
  }

  return <div className="fc-shell">
    {criticalOpen && <div className="fc-alert"><div className="fc-alert-icon"><AlertTriangle size={17}/></div><div><b>Alertas críticos</b><span>Monitoreamento de risco requer atenção: revise recusas e chargebacks do período.</span></div><button onClick={() => setCriticalOpen(false)} aria-label="Fechar alerta"><X size={16}/></button></div>}

    <section className="fc-metrics-grid">
      <Metric label="VOLUME PROCESSADO" value={money(net)} delta="8,4%" seed={net || 10}/>
      <Metric label="FATURAMENTO BRUTO" value={money(gross)} delta="12,1%" seed={gross || 10}/>
      <Metric label="FATURAMENTO LÍQUIDO" value={money(revenue - fees)} delta="9,7%" seed={net || 10}/>
      <Metric label="TICKET MÉDIO" value={money(avg)} delta="3,2%" seed={avg || 10}/>
      <Metric label="TAXAS" value={money(fees)} delta="1,8%" positive={false} seed={fees || 10}/>
      <Metric label="APROVAÇÃO" value={`${approval.toFixed(1)}%`} delta="2,6%" seed={approval || 10}/>
      <Metric label="REEMBOLSOS" value={String(refunds)} delta="0,8%" positive={false} seed={refunds || 10}/>
      <Metric label="CHARGEBACKS" value={String(chargebacks)} delta="0,2%" positive={false} seed={chargebacks || 10}/>
      <Metric label="PAGAMENTOS PENDENTES" value={String(pending)} delta="4,4%" seed={pending || 10}/>
    </section>

    <section className="fc-chart-layout">
      <article className="fc-panel fc-main-chart"><header className="fc-panel-head"><div><span className="fc-eyebrow">INTELIGÊNCIA FINANCEIRA</span><h2>{chart === 'revenue' ? 'Receita por período' : chart === 'approval' ? 'Taxa de aprovação' : 'Risco e chargeback'}</h2></div><div className="fc-chart-tabs"><button className={chart==='revenue'?'active':''} onClick={()=>setChart('revenue')}>Receita</button><button className={chart==='approval'?'active':''} onClick={()=>setChart('approval')}>Aprovação</button><button className={chart==='risk'?'active':''} onClick={()=>setChart('risk')}>Risco</button></div></header>
        <div className="fc-chart-legend"><span><i className="dot green"/>Principal</span><span><i className="dot muted"/>Período anterior</span></div>
        <ResponsiveContainer width="100%" height={280}>
          {chart === 'revenue' ? <AreaChart data={chartData}><defs><linearGradient id="fcGreen" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--althea-green)" stopOpacity={.38}/><stop offset="100%" stopColor="var(--althea-green)" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="rgba(255,255,255,.05)"/><XAxis dataKey="name" stroke="#607168" tickLine={false} axisLine={false}/><YAxis stroke="#607168" tickLine={false} axisLine={false} width={42}/><Tooltip contentStyle={{background:'#0F1A16',border:'1px solid rgba(29,184,84,.2)',borderRadius:12,color:'#fff'}}/><Area type="monotone" dataKey="revenue" stroke="var(--althea-green)" fill="url(#fcGreen)" strokeWidth={2}/></AreaChart> : chart === 'approval' ? <BarChart data={chartData}><CartesianGrid vertical={false} stroke="rgba(255,255,255,.05)"/><XAxis dataKey="name" stroke="#607168" tickLine={false} axisLine={false}/><YAxis domain={[0,100]} stroke="#607168" tickLine={false} axisLine={false}/><Tooltip contentStyle={{background:'#0F1A16',border:'1px solid rgba(29,184,84,.2)',borderRadius:12}}/><Bar dataKey="approved" fill="var(--althea-green)" radius={[4,4,0,0]}/><Bar dataKey="declined" fill="#34453d" radius={[4,4,0,0]}/></BarChart> : <LineChart data={chartData}><CartesianGrid vertical={false} stroke="rgba(255,255,255,.05)"/><XAxis dataKey="name" stroke="#607168" tickLine={false} axisLine={false}/><YAxis stroke="#607168" tickLine={false} axisLine={false}/><Tooltip contentStyle={{background:'#0F1A16',border:'1px solid rgba(29,184,84,.2)',borderRadius:12}}/><Line type="monotone" dataKey="risk" stroke="#D4AF37" strokeWidth={2}/><Line type="monotone" dataKey="limit" stroke="#6e8278" strokeDasharray="5 5"/></LineChart>}
        </ResponsiveContainer>
      </article>
      <aside className="fc-panel fc-live"><header className="fc-panel-head"><div><span className="fc-eyebrow">EVENT CENTER</span><h2>Atividade</h2></div><button className="fc-icon-btn" onClick={onRefresh} aria-label="Atualizar"><RefreshCw size={15}/></button></header><div className="fc-feed">{(tx.slice(0,7).length ? tx.slice(0,7) : [{id:'EVT-000',status:'processing',amount:0} as CommandTx]).map((t,i)=><div className="fc-feed-row" key={`${t.id}-${i}`}><span className={`feed-pulse ${status(t.status)==='Approved'?'ok':''}`}/><div><b>{status(t.status)==='Approved'?'Pagamento aprovado':status(t.status)==='Processing'?'Processando pagamento':'Transação recusada'}</b><small>{t.id} · {t.gateway_id || 'gateway'}</small></div><time>{i + 1}m</time></div>)}</div></aside>
    </section>

    <section className="fc-panel fc-sales"><header className="fc-panel-head fc-sales-head"><div><span className="fc-eyebrow">OPERAÇÃO</span><h2>Vendas</h2><small>{filtered.length} transações no recorte atual</small></div><div className="fc-tools"><label><Search size={15}/><input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Buscar ID, cliente, gateway..."/></label><button className="fc-filter-btn"><SlidersHorizontal size={14}/> Filtros</button></div></header><div className="fc-status-tabs">{['All','Approved','Processing','Declined','Refunded'].map(x=><button key={x} className={filter===x?'active':''} onClick={()=>{setFilter(x);setPage(1)}}>{x==='All'?'Todas':x}</button>)}</div>
      <div className="fc-table-wrap"><table className="fc-table"><thead><tr><th>TRANSAÇÃO</th><th>CLIENTE</th><th>VALOR</th><th>GATEWAY</th><th>STATUS</th><th>DATA</th><th/></tr></thead><tbody>{loading ? Array.from({length:6}).map((_,i)=><tr key={i}><td colSpan={7}><div className="fc-skeleton"/></td></tr>) : visible.map(t=><tr key={t.id} onClick={()=>{setSelected(t);setRefundDone(false)}}><td><b>{t.id.slice(0,18)}</b><small>{t.external_id || t.transaction_id || 'ID interno'}</small></td><td><b>{customerName(t.customer)}</b><small>{String(t.customer?.email || 'Cliente')}</small></td><td><b>{money(Number(t.amount)||0)}</b><small>{t.currency || 'BRL'}</small></td><td><span className="gateway-chip"><span/> {t.gateway_id || '—'}</span></td><td><span className={`fc-status ${status(t.status).toLowerCase()}`}><i/>{status(t.status)}</span></td><td>{t.created_at ? new Date(t.created_at).toLocaleString('pt-BR') : '—'}</td><td><ChevronRight size={15}/></td></tr>)}</tbody></table>{!loading&&!visible.length&&<div className="fc-empty">Nenhuma venda corresponde aos filtros.</div>}</div>
      <footer className="fc-pagination"><span>Mostrando {visible.length} de {filtered.length}</span><div><button disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Anterior</button><b>{page} / {pages}</b><button disabled={page>=pages} onClick={()=>setPage(p=>Math.min(pages,p+1))}>Próxima</button></div></footer>
    </section>

    <section className="fc-elite-grid"><Infrastructure/><FunnelMap/><CustomerRisk/></section>

    {selected && <div className="fc-overlay" onClick={()=>setSelected(null)}><aside className="fc-sheet" onClick={e=>e.stopPropagation()}><header><div><span className="fc-eyebrow">AUDITORIA CIRÚRGICA</span><h2>{selected.id}</h2><span className={`fc-status ${status(selected.status).toLowerCase()}`}><i/>{status(selected.status)}</span></div><button onClick={()=>setSelected(null)} className="fc-icon-btn"><X size={18}/></button></header><div className="fc-sheet-value"><span>Valor da transação</span><strong>{money(Number(selected.amount)||0)}</strong><small>{selected.currency || 'BRL'} · {selected.created_at ? new Date(selected.created_at).toLocaleString('pt-BR') : '—'}</small></div><div className="fc-audit-tree"><Audit title="Venda" icon={<CreditCard size={15}/>} items={[['ID',selected.id],['Moeda',selected.currency || 'BRL'],['Valor',money(Number(selected.amount)||0)]]}/><Audit title="Cliente" icon={<Users size={15}/>} items={[['Nome',customerName(selected.customer)],['E-mail',String(selected.customer?.email || 'não informado')],['IP',String(selected.customer?.ip || 'não informado')]]}/><Audit title="Produto / Funil" icon={<GitBranch size={15}/>} items={[['Produto',selected.product_id || 'não informado'],['Funil',selected.funnel_id || 'não informado']]}/><Audit title="Gateway & attempts" icon={<Network size={15}/>} items={[['Gateway',selected.gateway_id || 'não informado'],['Attempts','1 tentativa registrada'],['Status técnico',selected.status || 'não informado']]}/><Audit title="IDs externos & webhook" icon={<Webhook size={15}/>} items={[['Adquirente',selected.external_id || 'pendente'],['Transaction ID',selected.transaction_id || 'pendente'],['Webhook','Evento recebido / rastreável']]}/></div><div className="fc-timeline"><b>Timeline de eventos</b>{['Transação criada','Regra de roteamento aplicada','Gateway respondeu','Status atualizado'].map((x,i)=><div key={x}><span className={i<3?'done':''}>{i<3?<Check size={11}/>:<Clock3 size={11}/>}</span><div><b>{x}</b><small>{i<3?'Concluído':'Aguardando próximo evento'}</small></div></div>)}</div><button className="fc-refund" disabled={refundBusy||refundDone} onClick={quickRefund}>{refundBusy?<><RefreshCw className="spin" size={15}/> Processando...</>:refundDone?<><Check size={15}/> Estorno solicitado</>:<><RotateCcw size={15}/> Solicitar reembolso rápido</>}</button></aside></div>}
  </div>
}

function Audit({title,icon,items}:{title:string;icon:React.ReactNode;items:[string,string][]}) { return <details className="fc-audit" open><summary><span>{icon}<b>{title}</b></span><ChevronRight size={14}/></summary><div>{items.map(([k,v])=><p key={k}><span>{k}</span><b>{v}</b></p>)}</div></details> }
function Infrastructure(){ return <article className="fc-panel fc-infra"><header className="fc-panel-head"><div><span className="fc-eyebrow">INFRAESTRUTURA</span><h2>Gateways & roteamento</h2></div><button className="fc-outline"><KeyRound size={14}/> Credenciais</button></header><div className="gateway-grid">{['Stripe','Asaas','Mercado Pago'].map((g,i)=><div className="gateway-card" key={g}><div className="gateway-top"><span className="gateway-logo">{g.slice(0,1)}</span><span className={i===2?'offline':'online'}>{i===2?'Offline':'Conectado'}</span></div><b>{g}</b><div className="health"><span>Health Score</span><strong>{i===2?'0':'9'+(7-i)}/100</strong></div><div className="health-bar"><i style={{width:`${i===2?7:97-i*8}%`}}/></div><div className="gateway-stats"><span>Latência <b>{i===2?'—':(82+i*19)+'ms'}</b></span><span>Aprovação <b>{i===2?'—':(96-i*3)+'%'}</b></span></div></div>)}</div><div className="route-rail"><div><small>01</small><b>Entrada</b><span>Transação</span></div><ChevronRight/><div className="rule"><small>02</small><b>Regra</b><span>Mastercard</span></div><ChevronRight/><div className="selected-route"><small>03</small><b>Gateway primário</b><span>Stripe · Verde</span></div><ChevronRight/><div className="retry"><small>04</small><b>Fallback</b><span>Retentativa síncrona</span></div><ChevronRight/><div><small>05</small><b>Gateway reserva</b><span>Asaas · Laranja</span></div></div></article> }
function FunnelMap(){ return <article className="fc-panel"><header className="fc-panel-head"><div><span className="fc-eyebrow">CONVERSÃO</span><h2>Mapa operacional do funil</h2></div><button className="fc-outline"><GitBranch size={14}/> Editor</button></header><div className="funnel-steps">{['Landing','Quiz','Checkout','Pagamento','Oferta'].map((x,i)=><div className="funnel-step" key={x}><span>0{i+1}</span><b>{x}</b><strong>{[100,72,54,48,16][i]}%</strong><small>{i===2?'abandono 18%':i===3?'Pix · Cartão':'conversão'}</small></div>)}</div><div className="fc-mini-controls"><button>Testes A/B</button><button>Automação</button><button>Webhooks</button><button className="publish"><Check size={13}/> Publicado</button></div><div className="funnel-meta"><span>Produto: <b>Checkout principal</b></span><span>Gateway: <b>Roteamento automático</b></span><span>Pixel: <b>Meta · Google</b></span><span>UTM: <b>campaign / source / medium</b></span></div></article> }
function CustomerRisk(){ return <article className="fc-panel fc-risk"><header className="fc-panel-head"><div><span className="fc-eyebrow">CRM & RISCO</span><h2>Inteligência do cliente</h2></div><ShieldCheck size={18}/></header><div className="customer-score"><div className="score-ring">A+</div><div><b>Perfil de risco saudável</b><span>LTV e comportamento consolidados</span></div></div><div className="customer-metrics"><div><span>LTV</span><b>R$ 4.820</b></div><div><span>Ticket médio</span><b>R$ 387</b></div><div><span>Último pagamento</span><b>Hoje</b></div></div><div className="tags"><span>Baleia</span><span>Recorrente</span><span>Baixo risco</span></div><div className="early-warning"><div><ShieldAlert size={16}/><div><b>Early Warning</b><span>0 disputas iminentes detectadas</span></div><button>Ver central</button></div></div></article> }

export function AdvancedHub(){ return <section className="fc-advanced-grid"><article className="fc-panel"><span className="fc-eyebrow">ANALYTICS</span><h2>Business Intelligence</h2><div className="hub-lines"><span>Receita por produto <b>↗ 18%</b></span><span>Conversão por funil <b>↗ 7%</b></span><span>Performance por gateway <b>↗ 4%</b></span><span>Pix · Cartão · Boleto <b>↗ 11%</b></span></div></article><article className="fc-panel"><span className="fc-eyebrow">INTEGRATION HUB</span><h2>APIs & Webhooks</h2><div className="hub-lines"><span><KeyRound/> API keys <b>3 ativas</b></span><span><Webhook/> Outbound <b>99,2% entrega</b></span><span><RefreshCw/> Retry tracker <b>12 tentativas</b></span><span><LockKeyhole/> Auditoria <b>Protegida</b></span></div></article></section> }
