'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Layers, Loader2, Package, Sparkles, Webhook, X } from 'lucide-react'
import FunnelCommercialSelector from '@/app/dashboard/funil/funnel-commercial-selector'
import type { FunnelCommercialSelection } from '@/app/dashboard/funil/funnel-commercial-selector'

type FunnelType = 'sales' | 'lead_capture' | 'launch' | 'product' | 'upsell_downsell' | 'subscription' | 'custom'
type ConnectionType = 'script' | 'webhook'

const types: Array<{ id: FunnelType; title: string; description: string }> = [
  { id: 'sales', title: 'Funil de venda', description: 'Jornada comercial com checkout e pagamento.' },
  { id: 'lead_capture', title: 'Captura de leads', description: 'Captação, segmentação e entrada no CRM.' },
  { id: 'launch', title: 'Lançamento', description: 'Pré-lançamento, abertura e conversão.' },
  { id: 'product', title: 'Produto', description: 'Oferta principal com jornada de compra.' },
  { id: 'upsell_downsell', title: 'Upsell / Downsell', description: 'Pós-compra e ofertas condicionais.' },
  { id: 'subscription', title: 'Assinatura', description: 'Jornada recorrente e recuperação.' },
  { id: 'custom', title: 'Personalizado', description: 'Estrutura definida pelo operador.' },
]

export default function NewFunnelPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [funnelType, setFunnelType] = useState<FunnelType>('sales')
  const [connectionType, setConnectionType] = useState<ConnectionType>('script')
  const [commercial, setCommercial] = useState<FunnelCommercialSelection>({ productId: '', gatewayId: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    if (!name.trim()) { setError('Informe o nome do funil.'); setSaving(false); return }
    if (!commercial.productId) { setError('Selecione um produto ativo para o funil.'); setSaving(false); return }
    if (!commercial.gatewayId) { setError('Selecione um gateway operacional para o funil.'); setSaving(false); return }
    try {
      const response = await fetch('/api/funnels/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ name: name.trim(), url: url.trim() || null, connection_type: connectionType, funnel_type: funnelType, product_id: commercial.productId, gateway_id: commercial.gatewayId }),
      })
      const body: unknown = await response.json().catch(() => ({}))
      const payload = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
      if (!response.ok) {
        const code = typeof payload.error === 'string' ? payload.error : ''
        const messages: Record<string, string> = {
          product_required: 'Selecione um produto ativo.',
          gateway_required: 'Selecione um gateway operacional.',
          product_not_found: 'O produto selecionado não existe mais.',
          gateway_not_found: 'O gateway selecionado não existe mais.',
          product_not_active: 'O produto selecionado não está ativo.',
          gateway_not_operational: 'O gateway selecionado não está operacional.',
          resource_organization_mismatch: 'O produto ou gateway não pertence à organização atual.',
        }
        throw new Error(messages[code] || code || 'Não foi possível criar o funil.')
      }
      const created = payload.funnel && typeof payload.funnel === 'object' ? payload.funnel as Record<string, unknown> : {}
      const funnelId = typeof created.id === 'string' ? created.id : ''
      if (!funnelId) throw new Error('O provisionamento não retornou o ID do funil.')
      router.push(`/dashboard/funil?funnel=${encodeURIComponent(funnelId)}`)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao criar o funil.')
      setSaving(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#020203] px-4 py-8 text-white">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400">ALTHEA PAY / FUNIS</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">Criar funil</h1>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">O funil orquestra um Produto e um Gateway existentes. A associação é criada na mesma transação do funil.</p>
          </div>
          <button type="button" onClick={() => router.back()} aria-label="Cancelar" className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.06] text-zinc-500 hover:text-white"><X className="h-4 w-4" /></button>
        </header>

        {error && <div className="rounded-xl border border-rose-500/20 bg-rose-950/20 p-3 text-xs text-rose-300">{error}</div>}

        <form onSubmit={create} className="space-y-5">
          <section className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4">
            <div className="mb-4 flex items-center gap-2"><Layers className="h-4 w-4 text-emerald-400" /><div><h2 className="text-sm font-bold">Tipo do funil</h2><p className="text-[10px] text-zinc-600">Define a intenção comercial inicial; a jornada continua configurável.</p></div></div>
            <div className="grid gap-2 sm:grid-cols-2">
              {types.map((type) => <button key={type.id} type="button" onClick={() => setFunnelType(type.id)} className={`rounded-xl border p-3 text-left transition ${funnelType === type.id ? 'border-emerald-500/30 bg-emerald-500/[0.07]' : 'border-white/[0.05] bg-[#121214] hover:border-white/[0.1]'}`}><div className="flex items-start gap-2"><span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${funnelType === type.id ? 'border-emerald-400 bg-emerald-400 text-black' : 'border-zinc-700'}`}>{funnelType === type.id && <Check className="h-3 w-3" />}</span><span><b className="block text-xs text-zinc-100">{type.title}</b><small className="mt-1 block text-[9px] leading-relaxed text-zinc-600">{type.description}</small></span></div></button>)}
            </div>
          </section>

          <section className="space-y-4 rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4">
            <div><h2 className="text-sm font-bold">Identidade</h2><p className="text-[10px] text-zinc-600">Dados básicos do novo funil.</p></div>
            <label className="block space-y-1"><span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Nome *</span><input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Funil Curso X" className="h-11 w-full rounded-xl border border-white/[0.05] bg-[#121214] px-3 text-xs text-zinc-200 outline-none focus:border-emerald-500/40" /></label>
            <label className="block space-y-1"><span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">URL da página</span><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://seusite.com.br" className="h-11 w-full rounded-xl border border-white/[0.05] bg-[#121214] px-3 text-xs text-zinc-200 outline-none focus:border-emerald-500/40" /></label>
          </section>

          <FunnelCommercialSelector value={commercial} onChange={setCommercial} />

          <section className="rounded-2xl border border-white/[0.05] bg-[#0b0b0d] p-4">
            <div className="mb-4 flex items-center gap-2"><Webhook className="h-4 w-4 text-emerald-400" /><div><h2 className="text-sm font-bold">Ingestão de eventos</h2><p className="text-[10px] text-zinc-600">A conexão técnica fica subordinada ao funil, sem duplicar Gateways.</p></div></div>
            <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setConnectionType('script')} className={`rounded-xl border p-3 text-left ${connectionType === 'script' ? 'border-emerald-500/30 bg-emerald-500/[0.07]' : 'border-white/[0.05] bg-[#121214]'}`}><b className="block text-xs">Script</b><span className="text-[9px] text-zinc-600">Credencial de eventos</span></button><button type="button" onClick={() => setConnectionType('webhook')} className={`rounded-xl border p-3 text-left ${connectionType === 'webhook' ? 'border-emerald-500/30 bg-emerald-500/[0.07]' : 'border-white/[0.05] bg-[#121214]'}`}><b className="block text-xs">Webhook</b><span className="text-[9px] text-zinc-600">Endpoint de eventos</span></button></div>
          </section>

          <button type="submit" disabled={saving || !name.trim() || !commercial.productId || !commercial.gatewayId} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-bold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{saving ? 'CRIANDO...' : 'CRIAR E PREPARAR JORNADA'}</button>
          <div className="flex items-center justify-center gap-2 text-[9px] text-zinc-600"><Package className="h-3 w-3" /> Produto + Gateway obrigatórios · associação atômica</div>
        </form>
      </div>
    </main>
  )
}
