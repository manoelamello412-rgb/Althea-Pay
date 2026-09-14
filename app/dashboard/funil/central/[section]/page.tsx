'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Activity, ArrowLeft, BarChart3, CheckCircle2, GitBranch, Loader2, Plus, RefreshCw, Settings2, ShoppingCart, Sparkles, Zap } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Section = 'etapas' | 'ofertas' | 'automacoes' | 'analytics' | 'eventos'
type Funnel = { id: string; nome: string; url: string | null; status: string | null }
type Step = { id: string; step_key: string; step_type: string; name: string; position: number; status: string }
type Offer = { id: string; name: string; offer_type: string; price: number | string; currency: string; status: string; product_id: string }
type Automation = { id: string; name: string; trigger_type: string; action_type: string; enabled: boolean }
type Event = { id: string; event_type: string; external_id: string | null; status: string; occurred_at: string; error_message: string | null }
type Metrics = { sales: number; revenue: number; events: number; failedEvents: number }

const sections: Section[] = ['etapas', 'ofertas', 'automacoes', 'analytics', 'eventos']
const sectionLabels: Record<Section, string> = { etapas: 'Etapas', ofertas: 'Ofertas', automacoes: 'Automações', analytics: 'Analytics', eventos: 'Eventos' }
const stepLabels: Record<string, string> = { entry: 'Entrada', landing: 'Landing', capture: 'Captura', sales_page: 'Página de vendas', offer: 'Oferta', checkout: 'Checkout', payment: 'Pagamento', order_bump: 'Order Bump', upsell: 'Upsell', downsell: 'Downsell', thank_you: 'Obrigado', custom: 'Personalizado' }
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)

export default function FunnelSectionPage({ params }: { params: { section: string } }) {
  const section = sections.includes(params.section as Section) ? params.section as Section : 'etapas'
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [steps, setSteps] = useState<Step[]>([])
  const [offers, setOffers] = useState<Offer[]>([])
  const [automations, setAutomations] = useState<Automation[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [metrics, setMetrics] = useState<Metrics>({ sales: 0, revenue: 0, events: 0, failedEvents: 0 })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setError('')
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) throw new Error('Sessão expirada. Faça login novamente.')
    const { data: funnelRows, error: funnelError } = await supabase.from('funnels').select('id,nome,url,status').eq('user_id', auth.user.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(100)
    if (funnelError) throw funnelError
    const list = (funnelRows ?? []) as Funnel[]
    setFunnels(list)
    const nextId = selectedId && list.some((item) => item.id === selectedId) ? selectedId : list[0]?.id ?? ''
    setSelectedId(nextId)
    if (!nextId) {
      setSteps([]); setOffers([]); setAutomations([]); setEvents([]); setMetrics({ sales: 0, revenue: 0, events: 0, failedEvents: 0 })
      return
    }
    const [stepResult, offerResult, automationResult, eventResult, salesResult, connectionResult] = await Promise.all([
      supabase.from('funnel_steps').select('id,step_key,step_type,name,position,status').eq('funnel_id', nextId).order('position', { ascending: true }),
      supabase.from('funnel_offers').select('id,name,offer_type,price,currency,status,product_id').eq('funnel_id', nextId).order('created_at', { ascending: false }),
      supabase.from('funnel_automation_rules').select('id,name,trigger_type,action_type,enabled').eq('funnel_id', nextId).order('created_at', { ascending: false }),
      supabase.from('integration_events').select('id,event_type,external_id,status,occurred_at,error_message').eq('funnel_id', nextId).order('created_at', { ascending: false }).limit(100),
      supabase.from('sales').select('amount,status').eq('user_id', auth.user.id).eq('funnel_id', nextId).limit(5000),
      supabase.from('funnel_connections').select('event_count,error_count').eq('user_id', auth.user.id).eq('funnel_id', nextId).maybeSingle(),
    ])
    for (const result of [stepResult, offerResult, automationResult, eventResult, salesResult, connectionResult]) if (result.error) throw result.error
    setSteps((stepResult.data ?? []) as Step[])
    setOffers((offerResult.data ?? []) as Offer[])
    setAutomations((automationResult.data ?? []) as Automation[])
    setEvents((eventResult.data ?? []) as Event[])
    const sales = (salesResult.data ?? []) as Array<{ amount: number | string | null; status: string | null }>
    const approved = sales.filter((sale) => sale.status === 'approved')
    const fallbackErrors = (eventResult.data ?? []).filter((event) => event.status === 'failed' || Boolean(event.error_message)).length
    setMetrics({ sales: approved.length, revenue: approved.reduce((sum, sale) => sum + Number(sale.amount ?? 0), 0), events: Number(connectionResult.data?.event_count ?? eventResult.data?.length ?? 0), failedEvents: Number(connectionResult.data?.error_count ?? fallbackErrors) })
  }, [selectedId, supabase])

  useEffect(() => {
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o workspace.')).finally(() => setLoading(false))
  }, [load])

  async function prepareJourney() {
    if (!selectedId || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const { data, error: rpcError } = await supabase.rpc('seed_funnel_structure', { target_funnel: selectedId })
      if (rpcError) throw rpcError
      setSteps((data ?? []) as Step[])
      setNotice('Estrutura comercial sincronizada no banco. Nenhum catálogo foi duplicado.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível preparar a jornada.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="grid min-h-screen place-items-center bg-[#020203] text-white"><Loader2 className="h-6 w-6 animate-spin text-emerald-400" /></div>
  const current = funnels.find((funnel) => funnel.id === selectedId)

  return <div className="min-h-screen bg-[#020203] pb-32 text-white">
    <header className="sticky top-0 z-40 border-b border-white/[0.05] bg-[#020203]/90 px-4 py-3 backdrop-blur-xl"><div className="mx-auto flex max-w-5xl items-center justify-between gap-3"><div><p className="text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-400">ALTHEA PAY / FUNIS</p><h1 className="mt-1 text-lg font-bold">Workspace comercial</h1></div><div className="flex items-center gap-2"><button type="button" onClick={() => void load()} className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.06] text-zinc-400 hover:text-white" aria-label="Atualizar"><RefreshCw className="h-4 w-4" /></button><Link href="/dashboard/funil/central" className="flex h-9 items-center gap-1.5 rounded-xl border border-white/[0.06] px-3 text-[10px] font-bold text-zinc-400 hover:text-white"><ArrowLeft className="h-3.5 w-3.5" /> CENTRAL</Link><Link href="/dashboard/funil" className="flex h-9 items-center gap-1.5 rounded-xl border border-emerald-500/25 px-3 text-[10px] font-bold text-emerald-400"><Settings2 className="h-3.5 w-3.5" /> CONEXÃO</Link></div></div></header>
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[9px] uppercase tracking-wider text-zinc-600">Funil selecionado</p><h2 className="mt-1 text-base font-bold">{current?.nome ?? 'Nenhum funil cadastrado'}</h2></div>{funnels.length > 0 && <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="h-10 rounded-xl border border-white/[0.06] bg-[#121214] px-3 text-xs text-zinc-200 outline-none">{funnels.map((funnel) => <option key={funnel.id} value={funnel.id}>{funnel.nome}</option>)}</select>}</div>
      <nav className="flex gap-2 overflow-x-auto pb-1">{sections.map((key) => <Link key={key} href={`/dashboard/funil/central/${key}`} className={`shrink-0 rounded-full border px-3 py-2 text-[10px] font-bold ${section === key ? 'border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-400' : 'border-white/[0.06] text-zinc-500 hover:text-zinc-200'}`}>{sectionLabels[key]}</Link>)}</nav>
      {error && <div className="rounded-xl border border-rose-500/20 bg-rose-950/20 p-3 text-xs text-rose-300">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3 text-xs text-emerald-300">{notice}</div>}
      {!selectedId ? <Empty title="Nenhum funil cadastrado" text="Crie o primeiro funil real pela conexão operacional. A central não inventa dados." href="/dashboard/funil" /> : section === 'etapas' ? <StepsView steps={steps} busy={busy} onPrepare={prepareJourney} /> : section === 'ofertas' ? <OffersView offers={offers} /> : section === 'automacoes' ? <AutomationView automations={automations} /> : section === 'analytics' ? <AnalyticsView metrics={metrics} /> : <EventsView events={events} />}
    </main>
  </div>
}

function StepsView({ steps, busy, onPrepare }: { steps: Step[]; busy: boolean; onPrepare: () => void }) {
  return <section className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4"><div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-bold">Jornada do funil</h2><p className="text-[10px] text-zinc-600">Etapas persistidas no banco e ordenadas por posição.</p></div><button type="button" disabled={busy} onClick={onPrepare} className="flex h-9 items-center gap-1.5 rounded-xl border border-emerald-500/25 px-3 text-[9px] font-bold text-emerald-400 disabled:opacity-50"><Zap className="h-3.5 w-3.5" /> {steps.length ? 'GARANTIR ESTRUTURA' : 'PREPARAR JORNADA'}</button></div>{steps.length ? <div className="mt-5 flex gap-2 overflow-x-auto pb-2">{steps.map((step, index) => <div key={step.id} className="flex shrink-0 items-center gap-2"><div className="w-40 rounded-xl border border-white/[0.06] bg-[#121214] p-3"><div className="flex items-center justify-between"><span className="text-[8px] font-mono text-zinc-600">{String(index + 1).padStart(2, '0')}</span><CheckCircle2 className={`h-3.5 w-3.5 ${step.status === 'active' ? 'text-emerald-400' : 'text-zinc-700'}`} /></div><b className="mt-3 block text-[10px]">{step.name}</b><span className="mt-1 block text-[8px] uppercase tracking-wider text-zinc-600">{stepLabels[step.step_type] ?? step.step_type}</span></div>{index < steps.length - 1 && <GitBranch className="h-4 w-4 rotate-90 text-zinc-700" />}</div>)}</div> : <Empty title="Nenhuma etapa persistida" text="Prepare a jornada para criar a estrutura comercial real do funil." />}</section>
}

function OffersView({ offers }: { offers: Offer[] }) {
  return <section className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4"><div className="flex items-center justify-between"><div><h2 className="text-sm font-bold">Ofertas</h2><p className="text-[10px] text-zinc-600">Ofertas vinculadas a produtos existentes.</p></div><Plus className="h-4 w-4 text-zinc-600" /></div>{offers.length ? <div className="mt-4 space-y-2">{offers.map((offer) => <div key={offer.id} className="flex items-center justify-between rounded-xl border border-white/[0.05] bg-[#121214] p-3"><div><b className="text-xs">{offer.name}</b><p className="mt-1 text-[9px] text-zinc-600">{offer.offer_type} · produto {offer.product_id}</p></div><div className="text-right"><b className="font-mono text-xs">{money(Number(offer.price))}</b><p className="text-[8px] uppercase text-zinc-600">{offer.status}</p></div></div>)}</div> : <Empty title="Nenhuma oferta vinculada" text="O catálogo continua centralizado em Produtos. Esta área só exibirá ofertas reais." />}</section>
}

function AutomationView({ automations }: { automations: Automation[] }) {
  return <section className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4"><h2 className="text-sm font-bold">Automações</h2><p className="text-[10px] text-zinc-600">Gatilhos e ações persistidos por funil.</p>{automations.length ? <div className="mt-4 space-y-2">{automations.map((automation) => <div key={automation.id} className="flex items-center justify-between rounded-xl border border-white/[0.05] bg-[#121214] p-3"><div><b className="text-xs">{automation.name}</b><p className="mt-1 text-[9px] text-zinc-600">{automation.trigger_type} → {automation.action_type}</p></div><span className={`rounded-full px-2 py-1 text-[8px] font-bold ${automation.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/[0.04] text-zinc-600'}`}>{automation.enabled ? 'ATIVA' : 'PAUSADA'}</span></div>)}</div> : <Empty title="Nenhuma automação cadastrada" text="Nenhum gatilho ou ação será inventado até existir uma regra real." />}</section>
}

function AnalyticsView({ metrics }: { metrics: Metrics }) {
  return <div className="space-y-4"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric icon={<ShoppingCart />} label="Vendas aprovadas" value={String(metrics.sales)} /><Metric icon={<BarChart3 />} label="Receita" value={money(metrics.revenue)} /><Metric icon={<Activity />} label="Eventos" value={String(metrics.events)} /><Metric icon={<Sparkles />} label="Eventos com erro" value={String(metrics.failedEvents)} /></div><section className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4"><h2 className="text-sm font-bold">Analytics operacional</h2><p className="mt-1 text-[10px] text-zinc-600">Os indicadores acima são calculados exclusivamente a partir das vendas, conexões e eventos persistidos.</p></section></div>
}

function EventsView({ events }: { events: Event[] }) {
  return <section className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4"><h2 className="text-sm font-bold">Eventos de integração</h2><p className="text-[10px] text-zinc-600">Últimos eventos reais registrados para este funil.</p>{events.length ? <div className="mt-4 space-y-2">{events.map((event) => <div key={event.id} className="rounded-xl border border-white/[0.05] bg-[#121214] p-3"><div className="flex items-center justify-between gap-3"><b className="text-xs">{event.event_type}</b><span className="rounded-full bg-white/[0.04] px-2 py-1 text-[8px] uppercase text-zinc-500">{event.status}</span></div><p className="mt-1 text-[9px] text-zinc-600">{event.external_id ? `ID externo: ${event.external_id}` : 'Sem ID externo'} · {new Date(event.occurred_at).toLocaleString('pt-BR')}</p>{event.error_message && <p className="mt-2 text-[9px] text-rose-300">{event.error_message}</p>}</div>)}</div> : <Empty title="Nenhum evento registrado" text="Eventos aparecerão aqui quando a integração receber dados reais." />}</section>
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="rounded-xl bg-[#121214] p-3"><div className="flex items-center gap-1.5 text-zinc-600">{icon}<span className="text-[8px] uppercase tracking-wider">{label}</span></div><b className="mt-2 block truncate text-sm font-mono">{value}</b></div>
}

function Empty({ title, text, href }: { title: string; text: string; href?: string }) {
  return <div className="mt-5 rounded-xl border border-dashed border-white/[0.06] p-10 text-center"><GitBranch className="mx-auto h-5 w-5 text-zinc-700" /><p className="mt-2 text-xs font-bold text-zinc-400">{title}</p><p className="mx-auto mt-1 max-w-md text-[10px] text-zinc-600">{text}</p>{href && <Link href={href} className="mt-4 inline-flex rounded-xl bg-emerald-500 px-4 py-2 text-[9px] font-bold text-black">ABRIR CONEXÃO</Link>}</div>
}
