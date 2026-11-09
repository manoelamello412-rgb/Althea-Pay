'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Loader2, Zap } from 'lucide-react'

type Gateway = { id: string; display_name: string | null; provider: string | null; environment: string | null; status: string | null }
type Binding = { gateway_id: string; is_primary: boolean; status: string }

export default function FunnelGatewaySwitch({ funnelId }: { funnelId: string }) {
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [currentId, setCurrentId] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/funnels/gateway?funnel_id=${encodeURIComponent(funnelId)}`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error || 'load_failed')
      const primary = ((body.bindings ?? []) as Binding[]).find((b) => b.is_primary && b.status === 'active')
      setGateways(((body.gateways ?? []) as Gateway[]).filter((g) => ['connected', 'degraded'].includes(String(g.status ?? '').toLowerCase())))
      setCurrentId(primary?.gateway_id ?? '')
      setSelectedId(primary?.gateway_id ?? '')
    } catch {
      setMessage({ ok: false, text: 'Não foi possível carregar as gateways do funil.' })
    } finally { setLoading(false) }
  }, [funnelId])

  useEffect(() => { setMessage(null); void load() }, [load])

  async function save() {
    setSaving(true); setMessage(null)
    try {
      const response = await fetch('/api/funnels/gateway', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ funnel_id: funnelId, gateway_id: selectedId }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error === 'forbidden' ? 'Sem permissão para trocar a gateway.' : 'Não foi possível trocar a gateway.')
      setCurrentId(selectedId)
      setMessage({ ok: true, text: 'Gateway do funil atualizada. Novos pagamentos já usam a nova gateway.' })
    } catch (cause) {
      setMessage({ ok: false, text: cause instanceof Error ? cause.message : 'Não foi possível trocar a gateway.' })
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-1.5">
      <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-500">Gateway de pagamento</span>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <select value={selectedId} disabled={loading || saving} onChange={(event) => setSelectedId(event.target.value)} aria-label="Gateway de pagamento do funil" className="h-10 w-full appearance-none rounded-xl border border-white/[0.04] bg-[#121214] px-3 pr-9 text-xs text-zinc-200 outline-none focus:border-emerald-500/40 disabled:opacity-50">
            {!currentId && <option value="">Nenhuma gateway principal</option>}
            {gateways.map((g) => <option key={g.id} value={g.id}>{g.display_name || g.provider || g.id} · {g.environment || 'default'}{g.id === currentId ? ' (atual)' : ''}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-zinc-600" />
        </div>
        <button type="button" onClick={() => void save()} disabled={loading || saving || !selectedId || selectedId === currentId} className="flex h-10 items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.08] px-3 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-40">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}TROCAR
        </button>
      </div>
      {message && <p role="status" className={`text-[9px] ${message.ok ? 'text-emerald-400' : 'text-rose-300'}`}>{message.text}</p>}
    </div>
  )
}
