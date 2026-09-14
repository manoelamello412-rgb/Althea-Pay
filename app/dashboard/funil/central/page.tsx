'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ArrowRight, BarChart3, CheckCircle2, GitBranch, Loader2, Plus, RefreshCw, Settings2, ShoppingCart, Sparkles, Zap } from 'lucide-react'
import MobileBottomNav from '@/components/mobile-bottom-nav'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Funnel = {
  id: string
  name: string
  status: string
  external_url: string | null
  created_at: string
}

type FunnelStep = {
  id: string
  step_key: string
  step_type: string
  name: string
  position: number
  status: string
}

type Metrics = {
  leads: number
  sales: number
  revenue: number
  approved: number
}

const stepLabels: Record<string, string> = {
  entry: 'Entrada',
  landing: 'Landing',
  capture: 'Captura',
  sales_page: 'Vendas',
  offer: 'Oferta',
  checkout: 'Checkout',
  payment: 'Pagamento',
  order_bump: 'Order Bump',
  upsell: 'Upsell',
  downsell: 'Downsell',
  thank_you: 'Obrigado',
  custom: 'Personalizado',
}

function money(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(value)
}

function statusLabel(status: string) {
  const normalized = status.toLowerCase()
  if (normalized === 'connected' || normalized === 'active') return 'ATIVO'
  if (normalized === 'paused') return 'PAUSADO'
  if (normalized === 'error') return 'ERRO'
  return 'RASCUNHO'
}

export default function FunnelCentralPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [steps, setSteps] = useState<FunnelStep[]>([])
  const [metrics, setMetrics] = useState<Metrics>({ leads: 0, sales: 0, revenue: 0, approved: 0 })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async (preferredId?: string) => {
    setError('')
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) throw new Error('Sessão expirada. Faça login novamente.')

    const { data, error: funnelError } = await supabase
      .from('funnels')
      .select('id,name,status,external_url,created_at')
      .eq('organization_id', (await supabase.from('organization_members').select('organization_id').eq('user_id', auth.user.id).limit(1).maybeSingle()).data?.organization_id ?? '')
      .order('created_at', { ascending: false })
      .limit(100)
    if (funnelError) throw funnelError

    const list = (data ?? []) as Funnel[]
    setFunnels(list)
    const id = preferredId && list.some((item) => item.id === preferredId) ? preferredId : selectedId && list.some((item) => item.id === selectedId) ? selectedId : list[0]?.id ?? ''
    setSelectedId(id)

    if (!id) {
      setSteps([])
      setMetrics({ leads: 0, sales: 0, revenue: 0, approved: 0 })
      return
    }

    const [{ data: stepRows, error: stepError }, { count: leadCount, error: leadError }, { data: salesRows, error: salesError }] = await Promise.all([
      supabase.from('funnel_steps').select('id,step_key,step_type,name,position,status').eq('funnel_id', id).order('position', { ascending: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('funnel_id', id),
      supabase.from('sales').select('amount,status').eq('funnel_id', id).limit(5000),
    ])
    if (stepError) throw stepError
    if (leadError) throw leadError
    if (salesError) throw salesError

    const sales = (salesRows ?? []) as Array<{ amount: number | string | null; status: string }>
    const approved = sales.filter((sale) => sale.status === 'approved')
    setSteps((stepRows ?? []) as FunnelStep[])
    setMetrics({
      leads: leadCount ?? 0,
      sales: sales.length,
      approved: approved.length,
      revenue: approved.reduce((sum, sale) => sum + Number(sale.amount ?? 0), 0),
    })
  }, [selectedId, supabase])

  useEffect(() => {
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os funis.')).finally(() => setLoading(false))
  }, [load])

  async function seedStructure() {
    if (!selectedId || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { data, error: rpcError } = await supabase.rpc('seed_funnel_structure', { target_funnel: selectedId })
      if (rpcError) throw rpcError
      setSteps((data ?? []) as FunnelStep[])
      setNotice('Estrutura comercial base criada no banco. Agora ela pode ser expandida sem duplicar Produtos, Gateways ou Clientes.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível preparar a estrutura do funil.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="min-h-screen bg-[#020203] text-white grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-emerald-400" /></div>

  const selected = funnels.find((item) => item.id === selectedId) ?? null
  const conversion = metrics.leads > 0 ? (metrics.approved / metrics.leads) * 100 : 0

  return (
    <div className="min-h-screen bg-[#020203] pb-32 text-white antialiased">
      <header className="sticky top-0 z-40 border-b border-white/[0.05] bg-[#020203]/90 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div><p className="text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-400">ALTHEA PAY / FUNIS</p><h1 className="mt-1 text-lg font-bold">Central comercial</h1></div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void load(selectedId)} className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.06] bg-white/[0.02] text-zinc-400"><RefreshCw className="h-4 w-4" /></button>
            <a href="/dashboard/funil" className="flex h-9 items-center gap-1.5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-3 text-[10px] font-bold text-emerald-400"><Settings2 className="h-3.5 w-3.5" /> INTEGRAÇÃO</a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-5">
        <section className="flex items-center gap-2 overflow-x-auto pb-1">
          <a href="/dashboard/funil" className="shrink-0 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[10px] text-zinc-400">Conexão</a>
          <span className="shrink-0 rounded-full border border-emerald-500/25 bg-emerald-500/[0.08] px-3 py-2 text-[10px] font-bold text-emerald-400">Visão comercial</span>
          <span className="shrink-0 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[10px] text-zinc-500">Etapas</span>
          <span className="shrink-0 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[10px] text-zinc-500">Ofertas</span>
          <span className="shrink-0 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[10px] text-zinc-500">Automações</span>
          <span className="shrink-0 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[10px] text-zinc-500">Analytics</span>
        </section>

        {error && <div className="rounded-xl border border-rose-500/20 bg-rose-950/20 p-3 text-xs text-rose-300">{error}</div>}
        {notice && <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3 text-xs text-emerald-300">{notice}</div>}

        {funnels.length === 0 ? (
          <section className="rounded-2xl border border-dashed border-white/[0.08] bg-[#0b0b0d] p-8 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-400"><Plus className="h-5 w-5" /></div>
            <h2 className="mt-4 text-sm font-bold">Nenhum funil cadastrado</h2>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-zinc-500">Crie o primeiro funil pela tela de conexão. A central comercial aparecerá automaticamente quando houver um registro real.</p>
            <a href="/dashboard/funil" className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-bold text-black"><Plus className="h-4 w-4" /> CRIAR FUNIL</a>
          </section>
        ) : (
          <>
            <section className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0"><span className="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-600">Funil selecionado</span><h2 className="mt-1 truncate text-base font-bold">{selected?.name}</h2></div>
                <select value={selectedId} onChange={(event) => void load(event.target.value)} className="max-w-[52%] rounded-xl border border-white/[0.06] bg-[#121214] px-3 py-2 text-[10px] text-zinc-200 outline-none">
                  {funnels.map((funnel) => <option key={funnel.id} value={funnel.id}>{funnel.name}</option>)}
                </select>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric icon={<Activity />} label="Leads" value={String(metrics.leads)} />
                <Metric icon={<ShoppingCart />} label="Vendas" value={String(metrics.approved)} />
                <Metric icon={<BarChart3 />} label="Receita" value={money(metrics.revenue)} />
                <Metric icon={<Sparkles />} label="Conversão" value={`${conversion.toFixed(2)}%`} />
              </div>
            </section>

            <section className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4">
              <div className="flex items-center justify-between"><div><h2 className="text-sm font-bold">Jornada do funil</h2><p className="text-[10px] text-zinc-600">A sequência comercial persistida no banco.</p></div><button type="button" onClick={() => void seedStructure()} disabled={busy} className="flex h-9 items-center gap-1.5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-3 text-[9px] font-bold text-emerald-400 disabled:opacity-50"><Zap className="h-3.5 w-3.5" /> {steps.length ? 'GARANTIR ESTRUTURA' : 'PREPARAR JORNADA'}</button></div>
              {steps.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-white/[0.06] p-7 text-center"><GitBranch className="mx-auto h-5 w-5 text-zinc-700" /><p className="mt-2 text-xs text-zinc-500">Este funil ainda não possui etapas comerciais.</p><p className="mt-1 text-[9px] text-zinc-700">Nenhum dado fictício será criado automaticamente.</p></div> : <div className="mt-5 overflow-x-auto pb-2"><div className="flex min-w-max items-center gap-2">{steps.map((step, index) => <div key={step.id} className="flex items-center gap-2"><div className="w-36 rounded-xl border border-white/[0.06] bg-[#121214] p-3"><div className="flex items-center justify-between"><span className="text-[8px] font-mono text-zinc-600">{String(index + 1).padStart(2, '0')}</span><CheckCircle2 className={`h-3.5 w-3.5 ${step.status === 'active' ? 'text-emerald-400' : 'text-zinc-700'}`} /></div><b className="mt-3 block text-[10px] text-zinc-200">{step.name}</b><span className="mt-1 block text-[8px] uppercase tracking-wider text-zinc-600">{stepLabels[step.step_type] ?? step.step_type}</span></div>{index < steps.length - 1 && <ArrowRight className="h-4 w-4 shrink-0 text-zinc-700" />}</div>)}</div></div>}
            </section>

            <section className="grid gap-3 sm:grid-cols-3">
              <ModuleCard icon={<ShoppingCart />} title="Checkout & ofertas" description="Conecte produto, oferta, checkout, order bump e pós-compra sem duplicar entidades." />
              <ModuleCard icon={<Zap />} title="Automações" description="Reaja a leads, checkout, pagamentos e eventos com ações controladas." />
              <ModuleCard icon={<BarChart3 />} title="Analytics" description="Acompanhe a conversão por etapa usando eventos, leads e vendas reais." />
            </section>
          </>
        )}
      </main>
      <MobileBottomNav />
    </div>
  )
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="rounded-xl bg-[#121214] p-3"><div className="flex items-center gap-1.5 text-zinc-600">{icon}<span className="text-[8px] uppercase tracking-wider">{label}</span></div><b className="mt-2 block truncate text-sm font-mono text-zinc-100">{value}</b></div>
}

function ModuleCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <div className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4"><div className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-500/10 text-emerald-400">{icon}</div><h3 className="mt-3 text-xs font-bold">{title}</h3><p className="mt-1 text-[9px] leading-relaxed text-zinc-600">{description}</p></div>
}
