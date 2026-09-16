'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, ChevronDown, GitBranch, Loader2, Plus, RefreshCw, Save, Zap } from 'lucide-react'
import Link from 'next/link'

type Step = { id: string; step_key: string; step_type: string; name: string; position: number; status: string; config: Record<string, unknown> | null }
type Journey = { funnel: { id: string; nome: string; status: string | null; funnel_type: string | null }; steps: Step[]; links: Array<{ id: string; from_step_id: string; to_step_id: string; priority: number }>; offers: Array<{ id: string; product_id: string; step_id: string | null; name: string; price: number; currency: string; status: string }>; gateway_bindings: Array<{ id: string; gateway_id: string; is_primary: boolean; status: string }> }

const types = [
  ['landing', 'Página'], ['capture', 'Captura'], ['sales_page', 'Página de vendas'], ['offer', 'Oferta'], ['checkout', 'Checkout'], ['payment', 'Pagamento'], ['order_bump', 'Order bump'], ['upsell', 'Upsell'], ['downsell', 'Downsell'], ['thank_you', 'Obrigado'], ['custom', 'Personalizado'],
]

const labels: Record<string, string> = { entry: 'Entrada', landing: 'Página', capture: 'Captura', sales_page: 'Página de vendas', offer: 'Oferta', checkout: 'Checkout', payment: 'Pagamento', order_bump: 'Order bump', upsell: 'Upsell', downsell: 'Downsell', thank_you: 'Obrigado', custom: 'Personalizado' }

export default function FunnelJourneyPage() {
  const params = useSearchParams()
  const funnelId = params.get('funnel') ?? ''
  const [journey, setJourney] = useState<Journey | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [newType, setNewType] = useState('landing')
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    if (!funnelId) { setError('Selecione um funil para abrir a jornada.'); setLoading(false); return }
    setLoading(true); setError('')
    try {
      const response = await fetch(`/api/funnels/journey?funnel_id=${encodeURIComponent(funnelId)}`, { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Não foi possível carregar a jornada.')
      setJourney(body as Journey)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao carregar a jornada.') } finally { setLoading(false) }
  }, [funnelId])

  useEffect(() => { void load() }, [load])

  async function addStep() {
    if (!funnelId || !newName.trim() || saving) return
    setSaving('new'); setError(''); setMessage('')
    try {
      const response = await fetch('/api/funnels/journey', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ funnel_id: funnelId, step_type: newType, name: newName.trim() }), cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Não foi possível adicionar a etapa.')
      setNewName(''); setMessage('Etapa adicionada à jornada.'); await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao adicionar etapa.') } finally { setSaving('') }
  }

  async function updateStep(step: Step, patch: { name?: string; status?: string }) {
    if (saving) return
    setSaving(step.id); setError(''); setMessage('')
    try {
      const response = await fetch('/api/funnels/journey', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step_id: step.id, ...patch }), cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Não foi possível salvar a etapa.')
      setJourney((current) => current ? { ...current, steps: current.steps.map((item) => item.id === step.id ? body.step : item) } : current)
      setMessage('Etapa atualizada.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao salvar a etapa.') } finally { setSaving('') }
  }

  if (loading) return <main className="min-h-screen bg-[#020203] grid place-items-center text-white"><Loader2 className="h-6 w-6 animate-spin text-emerald-400" /></main>

  return <main className="min-h-screen bg-[#020203] px-4 py-6 text-white">
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3"><Link href="/dashboard/funil" className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.06] text-zinc-400 hover:text-white"><ArrowLeft className="h-4 w-4" /></Link><div><p className="text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-400">ALTHEA PAY / FUNIL</p><h1 className="mt-1 text-xl font-bold">Jornada operacional</h1><p className="text-[10px] text-zinc-600">{journey?.funnel.nome ?? 'Funil'}</p></div></div>
        <button type="button" onClick={() => void load()} disabled={loading} className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.06] text-zinc-400 hover:text-white disabled:opacity-40"><RefreshCw className="h-3.5 w-3.5" /></button>
      </header>
      {error && <div className="rounded-xl border border-rose-500/20 bg-rose-950/20 p-3 text-xs text-rose-300">{error}</div>}
      {message && <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3 text-xs text-emerald-300">{message}</div>}
      {journey && <>
        <section className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4">
          <div className="mb-4 flex items-center gap-2"><GitBranch className="h-4 w-4 text-emerald-400" /><div><h2 className="text-sm font-bold">Fluxo</h2><p className="text-[9px] text-zinc-600">Sequência persistida no banco. Cada etapa é uma entidade operacional.</p></div></div>
          <div className="space-y-2">{journey.steps.map((step, index) => <div key={step.id} className="flex items-center gap-2"><div className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 text-[9px] font-mono text-emerald-400">{index + 1}</div><div className="min-w-0 flex-1 rounded-xl border border-white/[0.05] bg-[#121214] p-3"><div className="flex items-center justify-between gap-2"><div><b className="block text-xs text-zinc-100">{step.name}</b><span className="text-[9px] text-zinc-600">{labels[step.step_type] ?? step.step_type}</span></div><select value={step.status} onChange={(event) => void updateStep(step, { status: event.target.value })} disabled={saving === step.id} className="h-8 rounded-lg border border-white/[0.05] bg-[#0b0b0d] px-2 text-[9px] text-zinc-400"><option value="draft">Rascunho</option><option value="active">Ativa</option><option value="paused">Pausada</option><option value="archived">Arquivada</option></select></div><div className="mt-2 flex gap-2"><input defaultValue={step.name} aria-label={`Nome da etapa ${step.name}`} onBlur={(event) => { const value = event.target.value.trim(); if (value && value !== step.name) void updateStep(step, { name: value }) }} className="h-8 min-w-0 flex-1 rounded-lg border border-white/[0.05] bg-[#0b0b0d] px-2 text-[10px] text-zinc-300 outline-none focus:border-emerald-500/30" /><span className="flex items-center gap-1 rounded-lg border border-white/[0.05] px-2 text-[8px] text-zinc-600"><Zap className="h-3 w-3" /> {step.status}</span></div></div>{index < journey.steps.length - 1 && <div className="ml-3 h-3 w-px bg-white/[0.08]" />}</div>)}</div>
        </section>
        <section className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4">
          <div className="mb-4 flex items-center gap-2"><Plus className="h-4 w-4 text-emerald-400" /><div><h2 className="text-sm font-bold">Adicionar etapa</h2><p className="text-[9px] text-zinc-600">A nova etapa entra no final da jornada e recebe conexão com a etapa anterior.</p></div></div>
          <div className="grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]"><div className="relative"><select value={newType} onChange={(event) => setNewType(event.target.value)} className="h-10 w-full appearance-none rounded-xl border border-white/[0.05] bg-[#121214] px-3 pr-8 text-[10px] text-zinc-300">{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-zinc-600" /></div><input value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addStep() } }} placeholder="Nome da nova etapa" className="h-10 rounded-xl border border-white/[0.05] bg-[#121214] px-3 text-[10px] text-zinc-300 outline-none focus:border-emerald-500/30" /><button type="button" onClick={() => void addStep()} disabled={!newName.trim() || saving === 'new'} className="flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-[10px] font-bold text-black disabled:opacity-40">{saving === 'new' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} ADICIONAR</button></div>
        </section>
        <section className="grid gap-3 sm:grid-cols-2"><div className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4"><span className="text-[9px] uppercase tracking-wider text-zinc-600">Oferta vinculada</span><p className="mt-2 text-xs text-zinc-200">{journey.offers.length ? `${journey.offers.length} oferta(s) persistida(s)` : 'Nenhuma oferta adicional'}</p></div><div className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4"><span className="text-[9px] uppercase tracking-wider text-zinc-600">Gateway primário</span><p className="mt-2 text-xs text-zinc-200">{journey.gateway_bindings.find((item) => item.is_primary)?.gateway_id ?? 'Não definido'}</p></div></section>
      </>}
    </div>
  </main>
}
