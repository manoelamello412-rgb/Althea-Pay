'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Activity, ArrowRight, BarChart3, CheckCircle2, GitBranch, Loader2, Plus, RefreshCw, Settings2, ShoppingCart, Sparkles, Zap } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Tab = 'overview' | 'steps' | 'offers' | 'automations' | 'analytics' | 'events'
type Funnel = { id: string; nome: string; url: string | null; status: string | null; created_at: string | null }
type Step = { id: string; step_key: string; step_type: string; name: string; position: number; status: string }
type Offer = { id: string; name: string; offer_type: string; price: number | string | null; currency: string | null; status: string; product_id: string }
type Automation = { id: string; name: string; trigger_type: string; action_type: string; enabled: boolean }
type Event = { id: string; event_type: string; external_id: string | null; status: string; occurred_at: string; error_message: string | null }
type Metrics = { sales: number; revenue: number | null; currency: string; currencyCount: number; events: number; failedEvents: number; approval: number }

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Visão geral' }, { id: 'steps', label: 'Etapas' }, { id: 'offers', label: 'Ofertas' },
  { id: 'automations', label: 'Automações' }, { id: 'analytics', label: 'Analytics' }, { id: 'events', label: 'Eventos' },
]
const stepLabels: Record<string, string> = { entry: 'Entrada', landing: 'Landing', capture: 'Captura', sales_page: 'Página de vendas', offer: 'Oferta', checkout: 'Checkout', payment: 'Pagamento', order_bump: 'Order Bump', upsell: 'Upsell', downsell: 'Downsell', thank_you: 'Obrigado', custom: 'Personalizado' }
const money = (v: number, currency = 'BRL') => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(v)

export default function FunnelCentralPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [tab, setTab] = useState<Tab>('overview')
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [steps, setSteps] = useState<Step[]>([])
  const [offers, setOffers] = useState<Offer[]>([])
  const [automations, setAutomations] = useState<Automation[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [metrics, setMetrics] = useState<Metrics>({ sales: 0, revenue: 0, currency: 'BRL', currencyCount: 0, events: 0, failedEvents: 0, approval: 0 })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const initialFunnelId = useRef<string | null>(null)

  const load = useCallback(async (preferredId?: string) => {
    setError('')
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) throw new Error('Sessão expirada. Faça login novamente.')
    const { data: funnelRows, error: funnelError } = await supabase.from('funnels').select('id,nome,url,status,created_at').is('deleted_at', null).order('created_at', { ascending: false }).limit(100)
    if (funnelError) throw funnelError
    const list = (funnelRows ?? []) as Funnel[]
    setFunnels(list)
    const id = preferredId && list.some((f) => f.id === preferredId) ? preferredId : selectedId && list.some((f) => f.id === selectedId) ? selectedId : list[0]?.id ?? ''
    setSelectedId(id)
    if (!id) { setSteps([]); setOffers([]); setAutomations([]); setEvents([]); setMetrics({ sales: 0, revenue: 0, currency: 'BRL', currencyCount: 0, events: 0, failedEvents: 0, approval: 0 }); return }
    const [stepResult, offerResult, automationResult, eventResult, salesResult, connectionResult] = await Promise.all([
      supabase.from('funnel_steps').select('id,step_key,step_type,name,position,status').eq('funnel_id', id).order('position', { ascending: true }),
      supabase.from('funnel_offers').select('id,name,offer_type,price,currency,status,product_id').eq('funnel_id', id).order('created_at', { ascending: false }),
      supabase.from('funnel_automation_rules').select('id,name,trigger_type,action_type,enabled').eq('funnel_id', id).order('created_at', { ascending: false }),
      supabase.from('integration_events').select('id,event_type,external_id,status,occurred_at,error_message').eq('funnel_id', id).order('created_at', { ascending: false }).limit(100),
      supabase.from('sales').select('amount,status,currency').eq('funnel_id', id).limit(5000),
      supabase.from('funnel_connections').select('event_count,error_count').eq('funnel_id', id).maybeSingle(),
    ])
    for (const result of [stepResult, offerResult, automationResult, eventResult, salesResult, connectionResult]) if (result.error) throw result.error
    const sales = (salesResult.data ?? []) as Array<{ amount: number | string | null; status: string | null; currency: string | null }>
    const approved = sales.filter((s) => s.status === 'approved')
    const currencies = [...new Set(approved.map((sale) => sale.currency?.trim().toUpperCase() || 'BRL'))]
    const revenue = currencies.length <= 1 ? approved.reduce((sum, sale) => sum + Number(sale.amount ?? 0), 0) : null
    const eventList = (eventResult.data ?? []) as Event[]
    setSteps((stepResult.data ?? []) as Step[]); setOffers((offerResult.data ?? []) as Offer[]); setAutomations((automationResult.data ?? []) as Automation[]); setEvents(eventList)
    setMetrics({ sales: approved.length, revenue, currency: currencies[0] || 'BRL', currencyCount: currencies.length, events: Number(connectionResult.data?.event_count ?? eventList.length), failedEvents: Number(connectionResult.data?.error_count ?? eventList.filter((e) => e.status === 'failed' || e.error_message).length), approval: sales.length ? approved.length / sales.length * 100 : 0 })
  }, [selectedId, supabase])

  useEffect(() => {
    if (initialFunnelId.current === null) initialFunnelId.current = new URLSearchParams(window.location.search).get('funnel')?.trim() || ''
    const preferredId = initialFunnelId.current || undefined
    initialFunnelId.current = ''
    void load(preferredId).catch((e) => setError(e instanceof Error ? e.message : 'Não foi possível carregar a central.')).finally(() => setLoading(false))
  }, [load])

  useEffect(() => {
    if (!selectedId) return
    const channel = supabase.channel(`funnel-central-${selectedId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'integration_events', filter: `funnel_id=eq.${selectedId}` }, () => { void load(selectedId) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'funnel_steps', filter: `funnel_id=eq.${selectedId}` }, () => { void load(selectedId) })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [selectedId, supabase, load])

  async function prepareJourney() {
    if (!selectedId || busy) return
    setBusy(true); setError(''); setNotice('')
    try { const { data, error: rpcError } = await supabase.rpc('seed_funnel_structure', { target_funnel: selectedId }); if (rpcError) throw rpcError; setSteps((data ?? []) as Step[]); setNotice('Jornada comercial persistida no banco. Nenhum produto, gateway ou cliente foi duplicado.') }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível preparar a jornada.') }
    finally { setBusy(false) }
  }

  if (loading) return <div className="grid min-h-screen place-items-center bg-[#020203] text-white"><Loader2 className="h-6 w-6 animate-spin text-emerald-400" /></div>
  const current = funnels.find((f) => f.id === selectedId)
  return <div className="min-h-screen bg-[#020203] pb-32 text-white">
    <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-white/[0.05] bg-[#0c0c0e] p-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-400">FUNIS / OPERAÇÃO</p><h1 className="mt-1 text-xl font-bold">Central comercial</h1></div><div className="flex gap-2"><button type="button" onClick={() => void load(selectedId)} className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.06] text-zinc-400 hover:text-white" aria-label="Atualizar"><RefreshCw className="h-4 w-4" /></button><a href="/dashboard/funil" className="flex h-9 items-center gap-1.5 rounded-xl border border-emerald-500/25 px-3 text-[10px] font-bold text-emerald-400"><Settings2 className="h-3.5 w-3.5" /> CONEXÃO</a></div></div>
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[9px] uppercase tracking-wider text-zinc-600">Funil selecionado</p><h2 className="mt-1 text-base font-bold">{current?.nome ?? 'Nenhum funil cadastrado'}</h2></div>{funnels.length > 0 && <select value={selectedId} onChange={(e) => void load(e.target.value)} className="h-10 rounded-xl border border-white/[0.06] bg-[#121214] px-3 text-xs text-zinc-200 outline-none">{funnels.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select>}</div>
      <nav className="flex gap-2 overflow-x-auto pb-1">{tabs.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`shrink-0 rounded-full border px-3 py-2 text-[10px] font-bold ${tab === item.id ? 'border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-400' : 'border-white/[0.06] text-zinc-500 hover:text-zinc-200'}`}>{item.label}</button>)}</nav>
      {error && <div className="rounded-xl border border-rose-500/20 bg-rose-950/20 p-3 text-xs text-rose-300">{error}</div>}{notice && <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3 text-xs text-emerald-300">{notice}</div>}
      {!selectedId ? <Empty title="Nenhum funil cadastrado" text="A central não cria dados fictícios. Crie o primeiro funil pela conexão operacional." href="/dashboard/funil" /> : tab === 'overview' ? <Overview metrics={metrics} steps={steps} onPrepare={prepareJourney} busy={busy} /> : tab === 'steps' ? <Steps steps={steps} onPrepare={prepareJourney} busy={busy} /> : tab === 'offers' ? <Offers offers={offers} /> : tab === 'automations' ? <Automations automations={automations} /> : tab === 'analytics' ? <Analytics metrics={metrics} steps={steps} /> : <Events events={events} />}
    </main>
  </div>
}

function Overview({ metrics, steps, onPrepare, busy }: { metrics: Metrics; steps: Step[]; onPrepare: () => void; busy: boolean }) { return <div className="space-y-4"><section className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric icon={<ShoppingCart />} label="Vendas aprovadas" value={String(metrics.sales)} /><Metric icon={<BarChart3 />} label="Receita" value={metrics.revenue == null ? `${metrics.currencyCount} moedas` : money(metrics.revenue, metrics.currency)} /><Metric icon={<Activity />} label="Eventos" value={String(metrics.events)} /><Metric icon={<Sparkles />} label="Aprovação" value={`${metrics.approval.toFixed(1)}%`} /></section><Steps steps={steps} onPrepare={onPrepare} busy={busy} /><div className="grid gap-3 sm:grid-cols-3"><Card icon={<ShoppingCart />} title="Checkout & ofertas" text="Ofertas vinculam produtos existentes ao funil; o catálogo permanece centralizado em Produtos." /><Card icon={<Zap />} title="Automações" text="Gatilhos e ações ficam persistidos por funil e aparecem somente quando existem no banco." /><Card icon={<BarChart3 />} title="Analytics" text="Indicadores são calculados a partir de vendas e eventos reais, sem métricas inventadas." /></div></div> }
function Steps({ steps, onPrepare, busy }: { steps: Step[]; onPrepare: () => void; busy: boolean }) { return <section className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4"><div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-bold">Jornada comercial</h2><p className="text-[10px] text-zinc-600">Etapas persistidas no banco e ordenadas por posição.</p></div><button type="button" disabled={busy} onClick={onPrepare} className="flex h-9 items-center gap-1.5 rounded-xl border border-emerald-500/25 px-3 text-[9px] font-bold text-emerald-400 disabled:opacity-50"><Zap className="h-3.5 w-3.5" /> {steps.length ? 'GARANTIR ESTRUTURA' : 'PREPARAR JORNADA'}</button></div>{steps.length ? <div className="mt-5 flex gap-2 overflow-x-auto pb-2">{steps.map((step, i) => <div key={step.id} className="flex shrink-0 items-center gap-2"><div className="w-40 rounded-xl border border-white/[0.06] bg-[#121214] p-3"><div className="flex items-center justify-between"><span className="text-[8px] font-mono text-zinc-600">{String(i + 1).padStart(2, '0')}</span><CheckCircle2 className={`h-3.5 w-3.5 ${step.status === 'active' ? 'text-emerald-400' : 'text-zinc-700'}`} /></div><b className="mt-3 block text-[10px]">{step.name}</b><span className="mt-1 block text-[8px] uppercase tracking-wider text-zinc-600">{stepLabels[step.step_type] ?? step.step_type}</span></div>{i < steps.length - 1 && <ArrowRight className="h-4 w-4 text-zinc-700" />}</div>)}</div> : <div className="mt-5 rounded-xl border border-dashed border-white/[0.06] p-10 text-center"><GitBranch className="mx-auto h-5 w-5 text-zinc-700" /><p className="mt-2 text-xs text-zinc-500">Nenhuma etapa persistida.</p></div>}</section> }
function Offers({ offers }: { offers: Offer[] }) { return <section className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4"><h2 className="text-sm font-bold">Ofertas</h2><p className="text-[10px] text-zinc-600">Somente ofertas reais vinculadas ao funil.</p>{offers.length ? <div className="mt-4 space-y-2">{offers.map((o) => <div key={o.id} className="flex items-center justify-between rounded-xl border border-white/[0.05] bg-[#121214] p-3"><div><b className="text-xs">{o.name}</b><p className="mt-1 text-[9px] text-zinc-600">{o.offer_type} · produto {o.product_id}</p></div><div className="text-right"><b className="font-mono text-xs">{money(Number(o.price ?? 0), o.currency || 'BRL')}</b><p className="text-[8px] uppercase text-zinc-600">{o.status}</p></div></div>)}</div> : <Empty title="Nenhuma oferta vinculada" text="A área permanece vazia até existir uma oferta real no banco." />}</section> }
function Automations({ automations }: { automations: Automation[] }) { return <section className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4"><h2 className="text-sm font-bold">Automações</h2><p className="text-[10px] text-zinc-600">Regras persistidas por funil.</p>{automations.length ? <div className="mt-4 space-y-2">{automations.map((a) => <div key={a.id} className="flex items-center justify-between rounded-xl border border-white/[0.05] bg-[#121214] p-3"><div><b className="text-xs">{a.name}</b><p className="mt-1 text-[9px] text-zinc-600">{a.trigger_type} → {a.action_type}</p></div><span className={`rounded-full px-2 py-1 text-[8px] font-bold ${a.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>{a.enabled ? 'ATIVA' : 'PAUSADA'}</span></div>)}</div> : <Empty title="Nenhuma automação" text="Nenhuma regra foi cadastrada para este funil." />}</section> }
function Analytics({ metrics, steps }: { metrics: Metrics; steps: Step[] }) { return <section className="space-y-3"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric icon={<ShoppingCart />} label="Aprovadas" value={String(metrics.sales)} /><Metric icon={<BarChart3 />} label="Receita" value={metrics.revenue == null ? `${metrics.currencyCount} moedas` : money(metrics.revenue, metrics.currency)} /><Metric icon={<Activity />} label="Eventos" value={String(metrics.events)} /><Metric icon={<Zap />} label="Falhas" value={String(metrics.failedEvents)} /></div><section className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4"><h2 className="text-sm font-bold">Cobertura da jornada</h2><p className="mt-1 text-[10px] text-zinc-600">{steps.length} etapa(s) persistida(s) para o funil selecionado.</p></section></section> }
function Events({ events }: { events: Event[] }) { return <section className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4"><h2 className="text-sm font-bold">Eventos de integração</h2><p className="text-[10px] text-zinc-600">Últimos eventos reais recebidos pelo funil.</p>{events.length ? <div className="mt-4 space-y-2">{events.map((e) => <div key={e.id} className="rounded-xl border border-white/[0.05] bg-[#121214] p-3"><div className="flex items-center justify-between gap-3"><b className="text-xs">{e.event_type}</b><span className="text-[8px] uppercase text-zinc-500">{e.status}</span></div><p className="mt-1 text-[9px] text-zinc-600">{e.external_id ? `ID externo: ${e.external_id}` : 'Sem ID externo'} · {new Date(e.occurred_at).toLocaleString('pt-BR')}</p>{e.error_message && <p className="mt-2 text-[9px] text-rose-400">{e.error_message}</p>}</div>)}</div> : <Empty title="Nenhum evento recebido" text="A central exibirá os eventos assim que a integração receber dados reais." />}</section> }
function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) { return <div className="rounded-xl bg-[#121214] p-3"><div className="flex items-center gap-1.5 text-zinc-600">{icon}<span className="text-[8px] uppercase tracking-wider">{label}</span></div><b className="mt-2 block truncate text-sm font-mono">{value}</b></div> }
function Card({ icon, title, text }: { icon: ReactNode; title: string; text: string }) { return <div className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4"><div className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-500/10 text-emerald-400">{icon}</div><h3 className="mt-3 text-xs font-bold">{title}</h3><p className="mt-1 text-[9px] leading-relaxed text-zinc-600">{text}</p></div> }
function Empty({ title, text, href }: { title: string; text: string; href?: string }) { return <div className="rounded-2xl border border-dashed border-white/[0.08] bg-[#0b0b0d] p-10 text-center"><Plus className="mx-auto h-6 w-6 text-emerald-400" /><h2 className="mt-4 text-sm font-bold">{title}</h2><p className="mx-auto mt-2 max-w-sm text-xs text-zinc-500">{text}</p>{href && <a href={href} className="mt-5 inline-flex rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-bold text-black">IR PARA CONEXÃO</a>}</div> }
