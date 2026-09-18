'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronDown, Loader2, RefreshCw, Zap } from 'lucide-react'

type Gateway = { id: string; display_name: string | null; provider: string | null; environment: string | null; status: string | null }
type Binding = { gateway_id: string; is_primary: boolean; status: string }

export default function FunnelGatewaySelector({ funnelId }: { funnelId: string }) {
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function load() {
    if (!funnelId) return
    setLoading(true); setError('')
    try {
      const response = await fetch(`/api/funnels/gateway?funnel_id=${encodeURIComponent(funnelId)}`, { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error || 'Não foi possível carregar os gateways.')
      const rows = Array.isArray(body?.gateways) ? body.gateways as Gateway[] : []
      const bindings = Array.isArray(body?.bindings) ? body.bindings as Binding[] : []
      const primary = bindings.find((item) => item.is_primary && item.status === 'active')?.gateway_id ?? ''
      setGateways(rows.filter((item) => !['disabled', 'inactive', 'disconnected'].includes(String(item.status ?? '').toLowerCase())))
      setCurrent(primary); setNext(primary)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao carregar gateways.') } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [funnelId])

  async function switchGateway() {
    if (!next || next === current || saving) return
    setSaving(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/funnels/gateway', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ funnel_id: funnelId, gateway_id: next, make_primary: true }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error || 'Não foi possível trocar o gateway.')
      setCurrent(next); setMessage('Gateway principal alterado. As próximas operações usarão a nova conexão.')
      window.setTimeout(() => setMessage(''), 4000)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao trocar o gateway.') } finally { setSaving(false) }
  }

  const selected = gateways.find((gateway) => gateway.id === next)

  return (
    <section className="space-y-3 rounded-2xl border border-[rgba(29,184,84,.10)] bg-[#0c0c0e] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgba(29,184,84,.08)]"><Zap className="h-4 w-4 text-[var(--althea-brand)]" /></div><div><h3 className="text-xs font-bold text-zinc-200">Gateway de pagamento</h3><p className="text-[9px] text-zinc-500">Conexão operacional deste funil.</p></div></div>
        <button type="button" onClick={() => void load()} disabled={loading || saving} className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.06] text-zinc-500 hover:text-white disabled:opacity-40" aria-label="Atualizar gateways"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>
      {error && <div className="rounded-lg border border-rose-500/20 bg-rose-950/20 p-2 text-[10px] text-rose-300">{error}</div>}
      {message && <div className="flex items-center gap-1.5 rounded-lg border border-[rgba(29,184,84,.18)] bg-emerald-950/20 p-2 text-[10px] text-[#8edca5]"><Check className="h-3.5 w-3.5" />{message}</div>}
      {loading ? <div className="flex h-10 items-center justify-center text-[10px] text-zinc-500"><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Sincronizando conexões...</div> : gateways.length === 0 ? <div className="rounded-xl border border-white/[0.04] bg-[var(--althea-bg)] p-3 text-[10px] text-zinc-500">Nenhum gateway operacional conectado. Conecte um gateway no módulo Gateways para selecioná-lo aqui.</div> : <>
        <div className="relative"><select value={next} onChange={(event) => setNext(event.target.value)} disabled={saving} className="h-11 w-full appearance-none rounded-xl border border-white/[0.06] bg-[var(--althea-bg)] px-3 pr-9 text-xs text-zinc-200 outline-none focus:border-[rgba(29,184,84,.32)]"><option value="">Selecione um gateway</option>{gateways.map((gateway) => <option key={gateway.id} value={gateway.id}>{gateway.display_name || gateway.provider || gateway.id} · {gateway.environment || 'default'}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-zinc-600" /></div>
        {selected && <div className="flex items-center justify-between rounded-xl border border-white/[0.04] bg-[var(--althea-bg)] px-3 py-2"><div><span className="block text-[10px] font-semibold text-zinc-200">{selected.display_name || selected.provider || selected.id}</span><span className="text-[8px] font-mono text-zinc-600">{selected.provider || 'provider-agnostic'} · {selected.environment || 'default'}</span></div><span className="text-[8px] font-bold text-[var(--althea-brand)]">{next === current ? 'ATUAL' : 'NOVA SELEÇÃO'}</span></div>}
        <button type="button" onClick={() => void switchGateway()} disabled={!next || next === current || saving} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[var(--althea-brand)] px-4 text-[10px] font-bold text-black hover:bg-[var(--althea-brand)] disabled:cursor-not-allowed disabled:opacity-35">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}{saving ? 'TROCANDO...' : 'ALTERAR GATEWAY DO FUNIL'}</button>
      </>}
    </section>
  )
}
