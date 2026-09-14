'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Activity, ArrowRight, BarChart3, CheckCircle2, GitBranch, Loader2, Plus, RefreshCw, Settings2, ShoppingCart, Sparkles, Zap } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Funnel = { id: string; nome: string; url: string | null; status: string | null; created_at: string | null }
type FunnelStep = { id: string; step_key: string; step_type: string; name: string; position: number; status: string }
type Metrics = { sales: number; revenue: number; events: number; conversion: number }
const labels: Record<string, string> = { entry: 'Entrada', landing: 'Landing', capture: 'Captura', sales_page: 'Vendas', offer: 'Oferta', checkout: 'Checkout', payment: 'Pagamento', order_bump: 'Order Bump', upsell: 'Upsell', downsell: 'Downsell', thank_you: 'Obrigado', custom: 'Personalizado' }
const money = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

export default function FunnelCentralPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [funnels, setFunnels] = useState<Funnel[]>([]); const [selectedId, setSelectedId] = useState(''); const [steps, setSteps] = useState<FunnelStep[]>([])
  const [metrics, setMetrics] = useState<Metrics>({ sales: 0, revenue: 0, events: 0, conversion: 0 }); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('')

  const load = useCallback(async (preferredId?: string) => {
    setError('')
    const { data: auth, error: authError } = await supabase.auth.getUser(); if (authError || !auth.user) throw new Error('Sessão expirada. Faça login novamente.')
    const { data, error: funnelError } = await supabase.from('funnels').select('id,nome,url,status,created_at').eq('user_id', auth.user.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(100)
    if (funnelError) throw funnelError
    const list = (data ?? []) as Funnel[]; setFunnels(list)
    const id = preferredId && list.some((f) => f.id === preferredId) ? preferredId : selectedId && list.some((f) => f.id === selectedId) ? selectedId : list[0]?.id ?? ''; setSelectedId(id)
    if (!id) { setSteps([]); setMetrics({ sales: 0, revenue: 0, events: 0, conversion: 0 }); return }
    const [{ data: stepRows, error: stepError }, { data: salesRows, error: salesError }, { data: connection, error: connectionError }] = await Promise.all([
      supabase.from('funnel_steps').select('id,step_key,step_type,name,position,status').eq('funnel_id', id).order('position', { ascending: true }),
      supabase.from('sales').select('amount,status').eq('user_id', auth.user.id).eq('funnel_id', id).limit(5000),
      supabase.from('funnel_connections').select('event_count').eq('user_id', auth.user.id).eq('funnel_id', id).maybeSingle(),
    ])
    if (stepError) throw stepError; if (salesError) throw salesError; if (connectionError) throw connectionError
    const sales = (salesRows ?? []) as Array<{ amount: number | string | null; status: string | null }>; const approved = sales.filter((s) => s.status === 'approved'); const revenue = approved.reduce((sum, s) => sum + Number(s.amount ?? 0), 0)
    setSteps((stepRows ?? []) as FunnelStep[]); setMetrics({ sales: approved.length, revenue, events: Number(connection?.event_count ?? 0), conversion: sales.length ? approved.length / sales.length * 100 : 0 })
  }, [selectedId, supabase])

  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : 'Não foi possível carregar os funis.')).finally(() => setLoading(false)) }, [load])

  async function prepareJourney() {
    if (!selectedId || busy) return; setBusy(true); setError(''); setNotice('')
    try { const { data, error: rpcError } = await supabase.rpc('seed_funnel_structure', { target_funnel: selectedId }); if (rpcError) throw rpcError; setSteps((data ?? []) as FunnelStep[]); setNotice('Jornada comercial persistida. Nenhum produto, gateway ou cliente foi duplicado.') }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível preparar a jornada.') }
    finally { setBusy(false) }
  }

  if (loading) return <div className="grid min-h-screen place-items-center bg-[#020203] text-white"><Loader2 className="h-6 w-6 animate-spin text-emerald-400" /></div>
  return <div className="min-h-screen bg-[#020203] pb-32 text-white">
    <header className="sticky top-0 z-40 border-b border-white/[0.05] bg-[#020203]/90 px-4 py-3 backdrop-blur-xl"><div className="mx-auto flex max-w-4xl items-center justify-between"><div><p className="text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-400">ALTHEA PAY / FUNIS</p><h1 className="mt-1 text-lg font-bold">Central comercial</h1></div><div className="flex gap-2"><button type="button" onClick={() => void load(selectedId)} className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.06] text-zinc-400"><RefreshCw className="h-4 w-4" /></button><a href="/dashboard/funil" className="flex h-9 items-center gap-1.5 rounded-xl border border-emerald-500/25 px-3 text-[10px] font-bold text-emerald-400"><Settings2 className="h-3.5 w-3.5" /> CONEXÃO</a></div></div></header>
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-5">
      <nav className="flex gap-2 overflow-x-auto pb-1"><span className="shrink-0 rounded-full border border-emerald-500/25 bg-emerald-500/[0.08] px-3 py-2 text-[10px] font-bold text-emerald-400">Visão geral</span><span className="shrink-0 rounded-full border border-white/[0.06] px-3 py-2 text-[10px] text-zinc-500">Etapas</span><span className="shrink-0 rounded-full border border-white/[0.06] px-3 py-2 text-[10px] text-zinc-500">Ofertas</span><span className="shrink-0 rounded-full border border-white/[0.06] px-3 py-2 text-[10px] text-zinc-500">Automações</span><span className="shrink-0 rounded-full border border-white/[0.06] px-3 py-2 text-[10px] text-zinc-500">Analytics</span><span className="shrink-0 rounded-full border border-white/[0.06] px-3 py-2 text-[10px] text-zinc-500">Eventos</span></nav>
      {error && <div className="rounded-xl border border-rose-500/20 bg-rose-950/20 p-3 text-xs text-rose-300">{error}</div>}{notice && <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3 text-xs text-emerald-300">{notice}</div>}
      {funnels.length === 0 ? <section className="rounded-2xl border border-dashed border-white/[0.08] bg-[#0b0b0d] p-10 text-center"><Plus className="mx-auto h-6 w-6 text-emerald-400" /><h2 className="mt-4 text-sm font-bold">Nenhum funil cadastrado</h2><p className="mx-auto mt-2 max-w-sm text-xs text-zinc-500">A central não cria dados fictícios. Use a conexão para criar o primeiro funil real.</p><a href="/dashboard/funil" className="mt-5 inline-flex rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-bold text-black">CRIAR FUNIL</a></section> : <>
        <section className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[9px] uppercase tracking-wider text-zinc-600">Funil selecionado</p><h2 className="mt-1 text-base font-bold">{funnels.find((f) => f.id === selectedId)?.nome}</h2></div><select value={selectedId} onChange={(e) => void load(e.target.value)} className="rounded-xl border border-white/[0.06] bg-[#121214] px-3 py-2 text-[10px] text-zinc-200">{funnels.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></div><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric icon={<ShoppingCart />} label="Vendas aprovadas" value={String(metrics.sales)} /><Metric icon={<BarChart3 />} label="Receita" value={money(metrics.revenue)} /><Metric icon={<Activity />} label="Eventos recebidos" value={String(metrics.events)} /><Metric icon={<Sparkles />} label="Aprovação" value={`${metrics.conversion.toFixed(1)}%`} /></div></section>
        <section className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4"><div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-bold">Jornada comercial</h2><p className="text-[10px] text-zinc-600">Etapas reais, persistidas e ordenadas.</p></div><button type="button" disabled={busy} onClick={() => void prepareJourney()} className="flex h-9 items-center gap-1.5 rounded-xl border border-emerald-500/25 px-3 text-[9px] font-bold text-emerald-400 disabled:opacity-50"><Zap className="h-3.5 w-3.5" /> {steps.length ? 'GARANTIR ESTRUTURA' : 'PREPARAR JORNADA'}</button></div>{steps.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-white/[0.06] p-8 text-center"><GitBranch className="mx-auto h-5 w-5 text-zinc-700" /><p className="mt-2 text-xs text-zinc-500">Nenhuma etapa comercial cadastrada.</p></div> : <div className="mt-5 flex gap-2 overflow-x-auto pb-2">{steps.map((step, i) => <div key={step.id} className="flex shrink-0 items-center gap-2"><div className="w-36 rounded-xl border border-white/[0.06] bg-[#121214] p-3"><div className="flex items-center justify-between"><span className="text-[8px] font-mono text-zinc-600">{String(i + 1).padStart(2, '0')}</span><CheckCircle2 className={`h-3.5 w-3.5 ${step.status === 'active' ? 'text-emerald-400' : 'text-zinc-700'}`} /></div><b className="mt-3 block text-[10px]">{step.name}</b><span className="mt-1 block text-[8px] uppercase tracking-wider text-zinc-600">{labels[step.step_type] ?? step.step_type}</span></div>{i < steps.length - 1 && <ArrowRight className="h-4 w-4 text-zinc-700" />}</div>)}</div>}</section>
        <section className="grid gap-3 sm:grid-cols-3"><Card icon={<ShoppingCart />} title="Checkout & ofertas" text="A próxima camada conecta produtos e ofertas existentes ao fluxo, sem duplicar o catálogo." /><Card icon={<Zap />} title="Automações" text="Gatilhos de checkout, abandono, pagamento e pós-compra." /><Card icon={<BarChart3 />} title="Analytics" text="Eventos e vendas reais para medir cada etapa." /></section>
      </>}
    </main>
  </div>
}
function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) { return <div className="rounded-xl bg-[#121214] p-3"><div className="flex items-center gap-1.5 text-zinc-600">{icon}<span className="text-[8px] uppercase tracking-wider">{label}</span></div><b className="mt-2 block truncate text-sm font-mono">{value}</b></div> }
function Card({ icon, title, text }: { icon: ReactNode; title: string; text: string }) { return <div className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4"><div className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-500/10 text-emerald-400">{icon}</div><h3 className="mt-3 text-xs font-bold">{title}</h3><p className="mt-1 text-[9px] leading-relaxed text-zinc-600">{text}</p></div> }
