'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, CreditCard, GitBranch, LayoutDashboard, MoreHorizontal, Network, Settings, X } from 'lucide-react'

type Range = { start: string; end: string }
type Sale = { id: string; amount: number | string | null; currency?: string | null; status?: string | null; data?: any; attribution?: any; source?: string | null; medium?: string | null; campaign?: string | null; gateway_id?: string | null; occurred_at?: string | null; created_at?: string | null }
type Gateway = { id: string; data?: any }
type Dispute = { id: string; amount?: number | string | null; status?: string | null; created_at?: string | null }
type Health = { gateway_id?: string | null; gateway_name?: string | null; is_healthy?: boolean | null; latency_ms?: number | null; circuit_state?: string | null; checked_at?: string | null }

const TZ = 'America/Sao_Paulo'
const DAY_MS = 86400000
const pad = (n:number) => String(n).padStart(2,'0')
const parse = (v:string) => { const [y,m,d] = v.split('-').map(Number); return new Date(y,m-1,d) }
const iso = (d:Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
const addDays = (v:string,n:number) => { const d=parse(v); d.setDate(d.getDate()+n); return iso(d) }
const localISO = (d=new Date()) => new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(d)
const formatDate = (v:string) => parse(v).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit'})
const money = (v:number) => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2}).format(Number(v)||0)
const lower = (v:any) => String(v ?? '').toLowerCase()
const approved = (s:any) => ['approved','completed','paid','success','succeeded'].includes(lower(s))
const pending = (s:any) => ['pending','processing','created'].includes(lower(s))
const failed = (s:any) => ['failed','declined','cancelled','canceled','error'].includes(lower(s))
const refunded = (s:any) => lower(s)==='refunded'
const terminalChargeback = (s:any) => ['chargeback','lost'].includes(lower(s))
const obj = (v:any) => v && typeof v==='object' && !Array.isArray(v) ? v : {}
const amountOf = (s:Sale) => Number(s.amount ?? obj(s.data).amount ?? 0) || 0
const saleDate = (s:Sale) => s.occurred_at || s.created_at || ''

function calendar(month:Date){
  const first=new Date(month.getFullYear(),month.getMonth(),1)
  const start=new Date(first); start.setDate(first.getDate()-first.getDay())
  return Array.from({length:42},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);return{value:iso(d),day:d.getDate(),current:d.getMonth()===month.getMonth()}})
}

function paymentMethod(s:Sale){
  const d=obj(s.data)
  const value=d.payment_method ?? d.paymentMethod ?? d.method ?? d.payment?.method ?? d.payment?.payment_method
  return lower(value || 'outros').replace(/[- ]/g,'_')
}

function explicitFee(s:Sale){
  const d=obj(s.data)
  const value=d.fee_amount ?? d.feeAmount ?? d.fee ?? d.fees
  return value === undefined || value === null || value === '' ? null : Math.max(0,Number(value)||0)
}

export default function DashboardControl(){
  const db=useMemo(()=>createSupabaseBrowserClient(),[])
  const today=localISO()
  const minDate=addDays(today,-89)
  const [userId,setUserId]=useState('')
  const [range,setRange]=useState<Range>({start:today,end:today})
  const [draft,setDraft]=useState<Range>({start:today,end:today})
  const [periodOpen,setPeriodOpen]=useState(false)
  const [calendarOpen,setCalendarOpen]=useState(false)
  const [month,setMonth]=useState(parse(today))
  const [sales,setSales]=useState<Sale[]>([])
  const [disputes,setDisputes]=useState<Dispute[]>([])
  const [gateways,setGateways]=useState<Gateway[]>([])
  const [health,setHealth]=useState<Health[]>([])
  const [clientCount,setClientCount]=useState(0)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState<string|null>(null)
  const [lastSync,setLastSync]=useState<Date|null>(null)

  const load=useCallback(async()=>{
    const {data:{user}}=await db.auth.getUser()
    if(!user){setUserId('');setLoading(false);return}
    setUserId(user.id);setLoading(true);setError(null)
    try{
      const since=addDays(today,-89)
      const [s,d,g,h,c]=await Promise.all([
        db.from('sales').select('id,amount,currency,status,data,attribution,source,medium,campaign,gateway_id,occurred_at,created_at').eq('user_id',user.id).gte('created_at',`${since}T00:00:00-03:00`).order('created_at',{ascending:false}).limit(5000),
        db.from('disputes').select('id,amount,status,created_at').eq('user_id',user.id).gte('created_at',`${since}T00:00:00-03:00`).order('created_at',{ascending:false}).limit(2000),
        db.from('gateways').select('id,data').eq('user_id',user.id),
        db.from('gateway_health_snapshots').select('gateway_id,gateway_name,is_healthy,latency_ms,circuit_state,checked_at').eq('user_id',user.id).order('checked_at',{ascending:false}).limit(500),
        db.from('clients').select('id',{count:'exact',head:true}).eq('user_id',user.id)
      ])
      if(s.error) throw s.error
      if(d.error) throw d.error
      if(g.error) throw g.error
      if(h.error) throw h.error
      if(c.error) throw c.error
      setSales((s.data||[]) as Sale[])
      setDisputes((d.data||[]) as Dispute[])
      setGateways((g.data||[]) as Gateway[])
      const latest=new Map<string,Health>()
      ;(h.data||[]).forEach((x:any)=>{const key=String(x.gateway_id||x.gateway_name||'');if(key&&!latest.has(key))latest.set(key,x)})
      setHealth([...latest.values()])
      setClientCount(c.count||0)
      setLastSync(new Date())
    }catch(e:any){
      console.error('[ALTHEA-DASHBOARD]',e)
      setError('Não foi possível sincronizar o Dashboard.')
      setSales([]);setDisputes([]);setGateways([]);setHealth([])
    }finally{setLoading(false)}
  },[db,today])

  useEffect(()=>{void load()},[load])
  useEffect(()=>{
    if(!userId)return
    const channel=db.channel(`dashboard-${userId}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'sales',filter:`user_id=eq.${userId}`},()=>void load())
      .on('postgres_changes',{event:'*',schema:'public',table:'disputes',filter:`user_id=eq.${userId}`},()=>void load())
      .on('postgres_changes',{event:'*',schema:'public',table:'gateways',filter:`user_id=eq.${userId}`},()=>void load())
      .on('postgres_changes',{event:'*',schema:'public',table:'gateway_health_snapshots',filter:`user_id=eq.${userId}`},()=>void load())
      .subscribe()
    return()=>{void db.removeChannel(channel)}
  },[db,userId,load])

  const periodSales=useMemo(()=>sales.filter(s=>{const d=saleDate(s).slice(0,10);return d>=range.start&&d<=range.end}),[sales,range])
  const periodDisputes=useMemo(()=>disputes.filter(d=>{const v=(d.created_at||'').slice(0,10);return v>=range.start&&v<=range.end}),[disputes,range])
  const stats=useMemo(()=>{
    const gross=periodSales.filter(s=>approved(s.status)).reduce((n,s)=>n+amountOf(s),0)
    const feeValues=periodSales.filter(s=>approved(s.status)).map(explicitFee).filter((v):v is number=>v!==null)
    const fees=feeValues.reduce((n,v)=>n+v,0)
    const refundAmount=periodSales.filter(s=>refunded(s.status)).reduce((n,s)=>n+amountOf(s),0)
    const approvedCount=periodSales.filter(s=>approved(s.status)).length
    const pendingCount=periodSales.filter(s=>pending(s.status)).length
    const failedCount=periodSales.filter(s=>failed(s.status)).length
    const chargebackAmount=periodDisputes.filter(d=>terminalChargeback(d.status)).reduce((n,d)=>n+Number(d.amount||0),0)
    const chargebacks=periodDisputes.filter(d=>terminalChargeback(d.status)).length
    const net=gross-fees-refundAmount-chargebackAmount
    return{gross,fees,refundAmount,approvedCount,pendingCount,failedCount,total:periodSales.length,net,approval:periodSales.length?approvedCount/periodSales.length*100:0,ticket:approvedCount?gross/approvedCount:0,chargebacks,chargebackAmount,feesAvailable:feeValues.length>0}
  },[periodSales,periodDisputes])

  const series=useMemo(()=>{
    const map=new Map<string,number>()
    periodSales.filter(s=>approved(s.status)).forEach(s=>{const d=saleDate(s).slice(0,10);map.set(d,(map.get(d)||0)+amountOf(s))})
    const out:{date:string,value:number}[]=[];let cur=range.start
    while(cur<=range.end){out.push({date:cur,value:map.get(cur)||0});cur=addDays(cur,1)}
    return out
  },[periodSales,range])
  const chart=useMemo(()=>{
    const max=Math.max(1,...series.map(x=>x.value));const width=300,height=120,padX=8,padY=10
    const points=series.map((p,i)=>{const x=series.length===1?width/2:padX+i*(width-padX*2)/(series.length-1);const y=height-padY-(p.value/max)*(height-padY*2);return `${x.toFixed(1)},${y.toFixed(1)}`}).join(' ')
    return{points,max}
  },[series])
  const methods=useMemo(()=>{
    const labels:[string,string][]=[['pix','Pix'],['credit_card','Cartão'],['boleto','Boleto'],['debit_card','Débito'],['outros','Outros']]
    const total=periodSales.filter(s=>approved(s.status)).reduce((n,s)=>n+amountOf(s),0)
    return labels.map(([key,label])=>{const value=periodSales.filter(s=>approved(s.status)&&paymentMethod(s)===key).reduce((n,s)=>n+amountOf(s),0);return{label,value,percent:total?value/total*100:0}}).filter(x=>x.value>0)
  },[periodSales])
  const recent=periodSales.slice(0,5)
  const gatewayRows=useMemo(()=>gateways.map(g=>{const d=obj(g.data);const h=health.find(x=>String(x.gateway_id||'')===String(g.id))||health.find(x=>lower(x.gateway_name)===lower(d.name||d.provider||g.id));return{id:g.id,name:String(d.name||d.provider||g.id),healthy:h?.is_healthy??null,latency:h?.latency_ms??null,state:h?.circuit_state||null}}),[gateways,health])

  const applyPreset=(p:'today'|'yesterday'|'7'|'30'|'90')=>{const next=p==='today'?{start:today,end:today}:p==='yesterday'?{start:addDays(today,-1),end:addDays(today,-1)}:{start:addDays(today,-Number(p)+1),end:today};setRange(next);setDraft(next);setPeriodOpen(false);setCalendarOpen(false)}
  const openCustom=()=>{setDraft(range);setMonth(parse(range.start));setPeriodOpen(false);setCalendarOpen(true)}
  const selectDay=(v:string)=>{if(v<minDate||v>today)return;if(draft.start===draft.end||v<draft.start)setDraft({start:v,end:v});else setDraft({start:draft.start,end:v})}
  const applyCustom=()=>{if(draft.start<=draft.end){setRange(draft);setCalendarOpen(false)}}
  const daysSelected=Math.floor((parse(range.end).getTime()-parse(range.start).getTime())/DAY_MS)+1
  const calendarDays=calendar(month)
  const monthLabel=month.toLocaleDateString('pt-BR',{month:'long',year:'numeric'})
  const canPrev=month.getFullYear()>parse(minDate).getFullYear()||month.getMonth()>parse(minDate).getMonth()
  const canNext=month.getFullYear()<parse(today).getFullYear()||month.getMonth()<parse(today).getMonth()
  const go=(page:string)=>window.dispatchEvent(new CustomEvent('althea-mobile-page',{detail:page}))
  const labels=range.start===range.end?formatDate(range.start):`${formatDate(range.start)} — ${formatDate(range.end)}`

  return <section className="althea-mobile-dashboard" aria-label="Dashboard mobile">
    <header className="amd-header"><div className="amd-brand"><img src="/althea-logo.png" alt="Althea Pay" /></div><button className="amd-icon-button" type="button" aria-label="Mais opções"><MoreHorizontal size={19}/></button></header>
    <div className="amd-heading"><span className="amd-eyebrow">CONTROL PLANE</span><h1>Dashboard</h1><p>Visão geral do seu negócio</p></div>
    <div className="amd-period-wrap"><button className="amd-period" type="button" onClick={()=>setPeriodOpen(v=>!v)}><span className="amd-period-copy"><CalendarDays size={14}/><span>{labels}</span></span><span>⌄</span></button>{periodOpen&&<div className="amd-period-menu"><button type="button" onClick={()=>applyPreset('today')}>Hoje</button><button type="button" onClick={()=>applyPreset('yesterday')}>Ontem</button><button type="button" onClick={()=>applyPreset('7')}>Últimos 7 dias</button><button type="button" onClick={()=>applyPreset('30')}>Últimos 30 dias</button><button type="button" onClick={()=>applyPreset('90')}>Últimos 90 dias</button><button type="button" className="amd-period-custom" onClick={openCustom}>Personalizado <span>›</span></button></div>}</div>
    <div className="amd-filter-caption"><span>{daysSelected} {daysSelected===1?'dia selecionado':'dias selecionados'}</span><button type="button" onClick={()=>applyPreset('today')}>Hoje</button></div>
    {error&&<div className="amd-card amd-error-card"><strong>Sincronização interrompida</strong><p>{error}</p><button type="button" className="amd-secondary-button" onClick={()=>void load()}>Tentar novamente</button></div>}
    <div className="amd-kpis">{[
      ['Receita Bruta',money(stats.gross),'Volume aprovado'],['Faturamento Líquido',money(stats.net),stats.feesAvailable?'Após taxas, reembolsos e chargebacks':'Taxas reais ainda não registradas'],['Taxas Acumuladas',money(stats.fees),stats.feesAvailable?'Taxas registradas nas vendas':'Nenhuma taxa registrada'],['Taxa de Aprovação',`${stats.approval.toFixed(1)}%`,`${stats.approvedCount} aprovadas de ${stats.total}`],['Ticket Médio',money(stats.ticket),'Vendas aprovadas'],['Reembolsos',money(stats.refundAmount),'Valor reembolsado'],['Chargebacks',String(stats.chargebacks),money(stats.chargebackAmount)],['Pagamentos Pendentes',String(stats.pendingCount),'Aguardando conclusão']
    ].map(([label,value,note])=><article key={label} className={`amd-card amd-kpi ${loading?'amd-loading':''}`}><span>{label}</span>{loading?<div className="amd-skeleton-line"/>:<strong>{value}</strong>}<small>{note}</small></article>)}</div>

    <article className="amd-card amd-chart-card"><div className="amd-card-heading"><div><span className="amd-label">Receita ao longo do tempo</span><strong>{money(stats.gross)}</strong></div><BarChart3 size={17}/></div>{series.some(x=>x.value>0)?<><svg className="amd-chart" viewBox="0 0 300 120" preserveAspectRatio="none" role="img" aria-label="Gráfico de receita"><path className="amd-chart-grid" d="M8 30H292 M8 60H292 M8 90H292"/><polyline className="amd-chart-line" points={chart.points} fill="none"/></svg><div className="amd-chart-axis"><span>{formatDate(range.start)}</span><span>{formatDate(range.end)}</span></div></>:<div className="amd-chart-state"><BarChart3 size={20}/><span>Sem receita aprovada no período selecionado.</span></div>}</article>

    <article className="amd-card amd-revenue-card"><div className="amd-section-title"><span>Fontes de Receita</span><small>Distribuição por método</small></div>{methods.length?<div className="amd-source-layout"><div className="amd-donut"><span>{Math.round(methods[0].percent)}%</span><small>{methods[0].label}</small></div><div className="amd-source-list">{methods.map(m=><div key={m.label}><i/><span>{m.label}</span><b>{m.percent.toFixed(1)}%</b></div>)}</div></div>:<p className="amd-data-note">A distribuição aparecerá quando houver transações aprovadas reais.</p>}</article>

    <article className="amd-card amd-empty-card"><div className="amd-section-title"><span>Transações Recentes</span><small>Últimas vendas do período</small></div>{recent.length?<div className="amd-recent-list">{recent.map(s=><button key={s.id} type="button" className="amd-recent-row" onClick={()=>go('vendas')}><span><b>{String(obj(s.data).customer?.name||obj(s.data).customer?.email||s.external_id||s.id).slice(0,24)}</b><small>{formatDate(saleDate(s).slice(0,10))} · {s.gateway_id||'Gateway não identificado'}</small></span><strong>{money(amountOf(s))}</strong></button>)}</div>:<div className="amd-empty-state"><div className="amd-empty-icon"><CreditCard size={21}/></div><strong>Nenhuma transação encontrada</strong><p>As transações do período selecionado aparecerão aqui quando houver dados reais.</p><button type="button" className="amd-secondary-button" onClick={()=>go('vendas')}>Ir para Vendas</button></div>}</article>

    <article className="amd-card amd-gateway-card"><div className="amd-section-title"><span>Status dos Gateways</span><small>Saúde da infraestrutura</small></div>{gatewayRows.length?<div className="amd-gateway-list">{gatewayRows.map(g=><div key={g.id} className="amd-gateway-row"><span><b>{g.name}</b><small>{g.latency!==null?`${g.latency} ms`:'Saúde ainda não medida'}{g.state?` · ${g.state}`:''}</small></span><i className={g.healthy===true?'healthy':g.healthy===false?'down':'unknown'}/></div>)}</div>:<div className="amd-gateway-empty"><Network size={18}/><strong>Nenhum gateway conectado</strong><p>Conecte um gateway para acompanhar disponibilidade, saúde e processamento.</p><button type="button" className="amd-secondary-button" onClick={()=>go('gateways')}>Configurar gateway</button></div>}</article>

    <article className="amd-card amd-summary-card"><div className="amd-section-title"><span>Operação</span><small>Visão complementar</small></div><div className="amd-summary-grid"><div><b>{clientCount}</b><span>Clientes</span></div><div><b>{stats.failedCount}</b><span>Falhas</span></div><div><b>{loading?'—':lastSync?lastSync.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'—'}</b><span>Última sincronização</span></div></div></article>

    <nav className="amd-bottom-nav" aria-label="Navegação principal">{[["Dashboard",LayoutDashboard,'dashboard'],["Vendas",CreditCard,'vendas'],["Funis",GitBranch,'funis'],["Gateway",Network,'gateways'],["Configuração",Settings,'configuracoes']].map(([label,Icon,page])=><button key={String(page)} type="button" className={page==='dashboard'?'active':''} onClick={()=>go(String(page))}><Icon size={18}/><span>{String(label)}</span></button>)}</nav>

    {calendarOpen&&<div className="amd-calendar-overlay" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setCalendarOpen(false)}}><div className="amd-calendar-sheet" role="dialog" aria-modal="true" aria-label="Selecionar período"><div className="amd-calendar-head"><div><span className="amd-eyebrow">PERÍODO</span><strong>Selecionar datas</strong><small>Disponível nos últimos 90 dias</small></div><button type="button" onClick={()=>setCalendarOpen(false)} aria-label="Fechar"><X size={18}/></button></div><div className="amd-calendar-range"><div><span>De</span><b>{formatDate(draft.start)}</b></div><div><span>Até</span><b>{formatDate(draft.end)}</b></div></div><div className="amd-calendar-nav"><button type="button" disabled={!canPrev} onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}><ChevronLeft size={17}/></button><strong>{monthLabel}</strong><button type="button" disabled={!canNext} onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}><ChevronRight size={17}/></button></div><div className="amd-weekdays">{['D','S','T','Q','Q','S','S'].map((x,i)=><span key={`${x}-${i}`}>{x}</span>)}</div><div className="amd-calendar-grid">{calendarDays.map(d=>{const dis=d.value<minDate||d.value>today;const sel=d.value>=draft.start&&d.value<=draft.end;const edge=d.value===draft.start||d.value===draft.end;return <button key={d.value} type="button" disabled={dis} className={`${d.current?'':'outside'} ${sel?'selected':''} ${edge?'edge':''}`} onClick={()=>selectDay(d.value)}>{d.day}</button>})}</div><div className="amd-calendar-footer"><button type="button" className="amd-calendar-clear" onClick={()=>setDraft({start:today,end:today})}>Hoje</button><button type="button" className="amd-calendar-apply" onClick={applyCustom}>Aplicar período</button></div></div></div>}
  </section>
}
