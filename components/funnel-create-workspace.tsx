'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Layers, Loader2, Package, Sparkles, Webhook } from 'lucide-react'
import FunnelCommercialSelector from '@/app/dashboard/funil/funnel-commercial-selector'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
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

export default function FunnelCreateWorkspace({ context = 'funnel' }: { context?: 'funnel' | 'integration' }) {
  const router = useRouter()
  const integrationContext = context === 'integration'
  const backHref = integrationContext ? '/dashboard/integration-hub' : '/dashboard/funil'
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
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

    if (!name.trim()) {
      setError('Informe o nome do funil.')
      setSaving(false)
      return
    }
    try {
      const response = await fetch('/api/funnels/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          name: name.trim(),
          url: url.trim() || null,
          connection_type: connectionType,
          funnel_type: funnelType,
          product_id: commercial.productId,
          gateway_id: commercial.gatewayId,
        }),
      })

      const body: unknown = await response.json().catch(() => ({}))
      const payload = body && typeof body === 'object' && !Array.isArray(body)
        ? body as Record<string, unknown>
        : {}

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

      const created = payload.funnel && typeof payload.funnel === 'object'
        ? payload.funnel as Record<string, unknown>
        : {}
      const ingestion = payload.ingestion && typeof payload.ingestion === 'object'
        ? payload.ingestion as Record<string, unknown>
        : {}
      const funnelId = typeof created.id === 'string' ? created.id : ''

      if (!funnelId) throw new Error('O provisionamento não retornou o ID do funil.')

      const handoff: Record<string, string> = {
        funnelId,
        token: typeof ingestion.token === 'string' ? ingestion.token : '',
        eventEndpoint: typeof ingestion.event_endpoint === 'string' ? ingestion.event_endpoint : '',
      }

      if (connectionType === 'webhook') {
        const webhookResult = await supabase.functions.invoke('webhook-integrations', {
          body: { funnel_id: funnelId, name: name.trim() || 'Webhook do Funil', provider: 'custom' },
        })
        if (webhookResult.error || !webhookResult.data?.secret || !webhookResult.data?.endpoint) {
          handoff.warning = 'O funil foi criado, mas o webhook não pôde ser provisionado automaticamente. Você pode criá-lo na configuração do funil.'
        } else {
          handoff.webhookSecret = String(webhookResult.data.secret)
          handoff.webhookEndpoint = String(webhookResult.data.endpoint)
        }
      }

      try {
        window.sessionStorage.setItem('althea:funnel-provision-handoff', JSON.stringify(handoff))
      } catch {
        // O funil já foi criado; falha no armazenamento local não deve desfazer a operação.
      }

      router.push(`/dashboard/funil?funnel=${encodeURIComponent(funnelId)}`)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao criar o funil.')
      setSaving(false)
    }
  }

  return (
    <div className="w-full space-y-5 text-white">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">{integrationContext ? 'Revenue Source · Onboarding' : 'Operação de funis'}</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">{integrationContext ? 'Conectar funil externo' : 'Criar funil'}</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--althea-muted)]">
            Primeiro conecte a fonte e habilite a ingestão de eventos. Produto, gateway e controle remoto são opcionais e podem ser configurados depois.
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push(backHref)}
          className="inline-flex h-10 items-center gap-2 self-start rounded-xl border border-white/[.06] bg-[var(--althea-surface)] px-4 text-[10px] font-semibold text-[var(--althea-muted)] transition hover:text-white lg:self-auto"
        >
          <ArrowLeft size={14} />
          {integrationContext ? 'Voltar ao Integration Hub' : 'Voltar aos funis'}
        </button>
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-red-400/15 bg-red-400/[.05] px-4 py-3 text-xs text-red-200">
          {error}
        </div>
      )}

      <form onSubmit={create} className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,.9fr)]">
        <div className="space-y-4">
          <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
            <div className="mb-4 flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[rgba(29,184,84,.10)] bg-[rgba(29,184,84,.055)] text-[var(--althea-brand)]">
                <Layers size={16} />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-white">Tipo do funil</h2>
                <p className="mt-1 text-[10px] leading-4 text-[var(--althea-muted)]">Define a intenção comercial inicial; a jornada permanece configurável.</p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {types.map((type) => {
                const active = funnelType === type.id
                return (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => setFunnelType(type.id)}
                    className={`rounded-xl border p-3 text-left transition ${active ? 'border-[rgba(29,184,84,.20)] bg-[rgba(29,184,84,.065)]' : 'border-white/[.045] bg-[var(--althea-bg)] hover:border-white/[.09]'}`}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${active ? 'border-[var(--althea-brand)] bg-[var(--althea-brand)] text-[#06110a]' : 'border-white/[.15]'}`}>
                        {active && <Check size={11} />}
                      </span>
                      <span>
                        <b className="block text-[10px] font-semibold text-white">{type.title}</b>
                        <small className="mt-1 block text-[9px] leading-4 text-[var(--althea-muted)]">{type.description}</small>
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
            <div>
              <h2 className="text-sm font-semibold text-white">Identidade</h2>
              <p className="mt-1 text-[10px] text-[var(--althea-muted)]">Dados básicos do novo funil.</p>
            </div>

            <div className="mt-4 grid gap-4">
              <label className="grid gap-1.5 text-[10px] font-medium text-[var(--althea-muted)]">
                Nome *
                <input
                  required
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ex.: Funil Curso X"
                  className="althea-ds-input text-sm"
                />
              </label>

              <label className="grid gap-1.5 text-[10px] font-medium text-[var(--althea-muted)]">
                URL da página
                <input
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://seusite.com.br"
                  className="althea-ds-input text-sm"
                />
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
            <div className="mb-4 flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[rgba(29,184,84,.10)] bg-[rgba(29,184,84,.055)] text-[var(--althea-brand)]">
                <Webhook size={16} />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-white">Ingestão de eventos</h2>
                <p className="mt-1 text-[10px] leading-4 text-[var(--althea-muted)]">A conexão técnica fica subordinada ao funil, sem criar uma segunda área de gateways.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {([
                ['script', 'Script', 'Credencial de eventos'],
                ['webhook', 'Webhook', 'Endpoint de eventos'],
              ] as const).map(([id, title, description]) => {
                const active = connectionType === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setConnectionType(id)}
                    className={`rounded-xl border p-3 text-left transition ${active ? 'border-[rgba(29,184,84,.20)] bg-[rgba(29,184,84,.065)]' : 'border-white/[.045] bg-[var(--althea-bg)]'}`}
                  >
                    <b className="block text-[10px] font-semibold text-white">{title}</b>
                    <span className="mt-1 block text-[9px] text-[var(--althea-muted)]">{description}</span>
                  </button>
                )
              })}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <FunnelCommercialSelector value={commercial} onChange={setCommercial} />

          <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[rgba(29,184,84,.10)] bg-[rgba(29,184,84,.055)] text-[var(--althea-brand)]">
                <Package size={16} />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-white">Pronto para conectar</h2>
                <p className="mt-1 text-[10px] leading-4 text-[var(--althea-muted)]">O funil, a conexão e a credencial de ingestão são provisionados juntos. Vínculos comerciais selecionados também entram na mesma operação.</p>
              </div>
            </div>

            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--althea-brand)] px-4 text-[10px] font-bold text-[#06110a] shadow-[0_8px_28px_rgba(29,184,84,.14)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {saving ? 'Conectando...' : integrationContext ? 'Conectar fonte' : 'Criar e conectar funil'}
            </button>

            <p className="mt-3 text-center text-[8px] uppercase tracking-[.12em] text-[#5f6e66]">Conexão primeiro · produto e gateway opcionais</p>
          </section>
        </div>
      </form>
    </div>
  )
}
