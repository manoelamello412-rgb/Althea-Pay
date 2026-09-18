'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Braces,
  Check,
  ChevronRight,
  CircleDot,
  CreditCard,
  DatabaseZap,
  ExternalLink,
  KeyRound,
  Layers,
  Plus,
  RefreshCw,
  Router,
  Webhook,
} from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Json = Record<string, unknown>

type Metrics = {
  sources: number
  operational_sources: number
  awaiting_first_event: number
  sources_needing_attention: number
  gateways: number
  operational_gateways: number
  active_webhooks: number
  active_api_keys: number
}

type Checklist = {
  registered: boolean
  connection: boolean
  ingestion_ready: boolean
  first_event_received: boolean
  product_linked: boolean
  gateway_linked: boolean
  remote_control_ready: boolean
}

type RevenueSource = {
  id: string
  source_type: string
  source_ref_id: string | null
  name: string
  status: string
  funnel_type: string | null
  url: string | null
  connection_id: string | null
  connection_type: string | null
  connection_status: string | null
  health_status: string | null
  last_error: string | null
  last_event_at: string | null
  event_count: number
  error_count: number
  write_enabled: boolean
  control_status: string
  capabilities: string[] | Json
  has_ingestion_token: boolean
  webhook_count: number
  offer_count: number
  gateway_count: number
  onboarding_status: string
  onboarding_progress: number
  checklist: Checklist
  created_at: string
  updated_at: string
}

type Payload = {
  metrics: Metrics
  sources: RevenueSource[]
}

const EMPTY_METRICS: Metrics = {
  sources: 0,
  operational_sources: 0,
  awaiting_first_event: 0,
  sources_needing_attention: 0,
  gateways: 0,
  operational_gateways: 0,
  active_webhooks: 0,
  active_api_keys: 0,
}

const objectOf = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}

const numberOf = (value: unknown): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const dateTime = (value: unknown): string => {
  const parsed = new Date(typeof value === 'string' ? value : '')
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(parsed)
}

const sourceLabel: Record<string, string> = {
  funnel: 'Funil externo',
  direct_checkout: 'Checkout direto',
  payment_link: 'Link de pagamento',
  subscription: 'Assinatura',
  affiliate: 'Afiliado',
  marketplace: 'Marketplace',
  store: 'Loja',
  manual_sale: 'Venda manual',
  external_api: 'API externa',
  custom: 'Fonte personalizada',
}

const onboardingMeta: Record<string, { label: string; className: string }> = {
  operational: {
    label: 'Operacional',
    className: 'border-[rgba(29,184,84,.16)] bg-[rgba(29,184,84,.055)] text-[#78d899]',
  },
  awaiting_first_event: {
    label: 'Aguardando evento',
    className: 'border-[rgba(212,175,55,.18)] bg-[rgba(212,175,55,.055)] text-[#D4AF37]',
  },
  needs_connection: {
    label: 'Conexão pendente',
    className: 'border-red-400/15 bg-red-400/[.05] text-red-300',
  },
  needs_credential: {
    label: 'Credencial pendente',
    className: 'border-red-400/15 bg-red-400/[.05] text-red-300',
  },
  needs_attention: {
    label: 'Requer atenção',
    className: 'border-red-400/15 bg-red-400/[.05] text-red-300',
  },
  archived: {
    label: 'Arquivada',
    className: 'border-white/[.05] bg-white/[.02] text-[var(--althea-muted)]',
  },
}

export default function IntegrationHubPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [payload, setPayload] = useState<Payload | null>(null)
  const [organizationId, setOrganizationId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (initial = false) => {
    initial ? setLoading(true) : setRefreshing(true)
    setError('')
    try {
      const result = await db.rpc('integration_hub_overview_v1', { p_limit: 100 })
      if (result.error) throw result.error

      const data = objectOf(result.data)
      const metrics = objectOf(data.metrics)
      setPayload({
        metrics: {
          sources: numberOf(metrics.sources),
          operational_sources: numberOf(metrics.operational_sources),
          awaiting_first_event: numberOf(metrics.awaiting_first_event),
          sources_needing_attention: numberOf(metrics.sources_needing_attention),
          gateways: numberOf(metrics.gateways),
          operational_gateways: numberOf(metrics.operational_gateways),
          active_webhooks: numberOf(metrics.active_webhooks),
          active_api_keys: numberOf(metrics.active_api_keys),
        },
        sources: Array.isArray(data.sources) ? data.sources as RevenueSource[] : [],
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o Integration Hub.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [db])

  useEffect(() => { void load(true) }, [load])

  useEffect(() => {
    let active = true
    void db.auth.getUser().then(async ({ data }) => {
      if (!active || !data.user) return
      const profile = await db.from('profiles')
        .select('default_organization_id')
        .eq('id', data.user.id)
        .single()
      if (active && !profile.error && profile.data?.default_organization_id) {
        setOrganizationId(String(profile.data.default_organization_id))
      }
    })
    return () => { active = false }
  }, [db])

  useEffect(() => {
    if (!organizationId) return
    let timer: number | null = null
    const refresh = () => {
      if (timer !== null) return
      timer = window.setTimeout(() => {
        timer = null
        void load(false)
      }, 550)
    }

    const channel = db.channel(`integration-hub-${organizationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'funnel_connections', filter: `organization_id=eq.${organizationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'integration_events', filter: `organization_id=eq.${organizationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gateways', filter: `organization_id=eq.${organizationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'webhook_integrations', filter: `organization_id=eq.${organizationId}` }, refresh)
      .subscribe()

    return () => {
      if (timer !== null) window.clearTimeout(timer)
      void db.removeChannel(channel)
    }
  }, [db, load, organizationId])

  const metrics = payload?.metrics ?? EMPTY_METRICS
  const sources = payload?.sources ?? []

  return (
    <div className="w-full space-y-5">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Revenue Sources</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">Integration Hub</h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--althea-muted)]">
            Conecte fontes de receita e acompanhe o que está realmente operacional. O Hub organiza identidade, ingestão e saúde sem duplicar gateways, webhooks ou APIs.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load(false)}
            disabled={refreshing}
            className="grid h-10 w-10 place-items-center rounded-xl border border-white/[.055] bg-[var(--althea-surface)] text-[var(--althea-muted)] hover:text-white disabled:opacity-50"
            aria-label="Atualizar Integration Hub"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <Link
            href="/dashboard/integration-hub/connect"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--althea-brand)] px-4 text-[10px] font-bold text-[#06110a] shadow-[0_8px_28px_rgba(29,184,84,.14)] transition hover:brightness-110"
          >
            <Plus size={14} /> Conectar fonte
          </Link>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-red-400/15 bg-red-400/[.05] px-4 py-3 text-xs text-red-200">
          {error}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          icon={Layers}
          label="Fontes de receita"
          value={metrics.sources}
          note={`${metrics.operational_sources} operacionais`}
          success={metrics.sources > 0 && metrics.operational_sources === metrics.sources}
        />
        <Metric
          icon={CircleDot}
          label="Aguardando evento"
          value={metrics.awaiting_first_event}
          note="conectadas, ainda sem tráfego"
          warning={metrics.awaiting_first_event > 0}
        />
        <Metric
          icon={AlertTriangle}
          label="Requer atenção"
          value={metrics.sources_needing_attention}
          note="conexão, credencial ou saúde"
          warning={metrics.sources_needing_attention > 0}
        />
        <Metric
          icon={Router}
          label="Gateways"
          value={metrics.operational_gateways}
          note={`${metrics.operational_gateways}/${metrics.gateways} operacionais`}
          success={metrics.gateways > 0 && metrics.operational_gateways === metrics.gateways}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
        <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Fontes conectadas</h2>
              <p className="mt-1 text-[10px] text-[var(--althea-muted)]">Progresso calculado a partir do estado real da infraestrutura.</p>
            </div>
            <Activity size={16} className="text-[var(--althea-brand)]" />
          </div>

          {loading ? (
            <div className="mt-4 space-y-2">
              {[1, 2, 3].map(item => <div key={item} className="h-24 animate-pulse rounded-xl bg-[var(--althea-bg)]" />)}
            </div>
          ) : sources.length === 0 ? (
            <div className="mt-4 grid min-h-[270px] place-items-center rounded-xl border border-dashed border-white/[.055] bg-[var(--althea-bg)] p-6 text-center">
              <div className="max-w-sm">
                <DatabaseZap size={24} className="mx-auto text-[var(--althea-brand)]" />
                <h3 className="mt-3 text-xs font-semibold text-white">Conecte a primeira fonte de receita</h3>
                <p className="mt-2 text-[9px] leading-5 text-[var(--althea-muted)]">
                  O primeiro tipo operacional é o funil externo. A Althea cria a identidade, a conexão e a credencial de ingestão em uma única operação.
                </p>
                <Link href="/dashboard/integration-hub/connect" className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl bg-[var(--althea-brand)] px-4 text-[9px] font-bold text-[#06110a]">
                  <Plus size={13} /> Conectar funil externo
                </Link>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {sources.map(source => <SourceRow key={source.id} source={source} />)}
            </div>
          )}
        </article>

        <div className="space-y-4">
          <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-white">Infraestrutura conectada</h2>
                <p className="mt-1 text-[10px] text-[var(--althea-muted)]">Configurações continuam em suas áreas canônicas.</p>
              </div>
              <Braces size={16} className="text-[var(--althea-brand)]" />
            </div>

            <div className="mt-4 space-y-2">
              <InfrastructureLink
                href="/dashboard/gateways"
                icon={CreditCard}
                title="Gateways"
                value={`${metrics.operational_gateways}/${metrics.gateways}`}
                note="conectados e testados"
              />
              <InfrastructureLink
                href="/dashboard/webhooks"
                icon={Webhook}
                title="Webhooks"
                value={String(metrics.active_webhooks)}
                note="integrações ativas"
              />
              <InfrastructureLink
                href="/dashboard/api"
                icon={KeyRound}
                title="API"
                value={String(metrics.active_api_keys)}
                note="chaves ativas"
              />
            </div>
          </article>

          <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
            <h2 className="text-sm font-semibold text-white">Tipos de Revenue Source</h2>
            <p className="mt-1 text-[10px] leading-5 text-[var(--althea-muted)]">
              O catálogo já suporta múltiplos tipos. A interface só libera um tipo quando existe um adapter operacional de ponta a ponta.
            </p>
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between rounded-xl border border-[rgba(29,184,84,.12)] bg-[rgba(29,184,84,.045)] p-3">
                <div className="flex items-center gap-2">
                  <Layers size={14} className="text-[var(--althea-brand)]" />
                  <span className="text-[10px] font-medium text-white">Funil externo</span>
                </div>
                <span className="text-[8px] font-semibold uppercase text-[var(--althea-brand)]">Operacional</span>
              </div>
              <p className="px-1 text-[8px] leading-4 text-[#5f6e66]">
                Checkout direto, links, assinaturas, afiliados, marketplaces, lojas, vendas manuais e APIs externas permanecem no contrato do catálogo, mas não são exibidos como conectáveis até o runtime correspondente existir.
              </p>
            </div>
          </article>
        </div>
      </section>
    </div>
  )
}

function SourceRow({ source }: { source: RevenueSource }) {
  const meta = onboardingMeta[source.onboarding_status] ?? onboardingMeta.needs_attention
  const funnelHref = source.source_ref_id
    ? `/dashboard/funil?funnel=${encodeURIComponent(source.source_ref_id)}`
    : '/dashboard/integration-hub'

  return (
    <div className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[11px] font-semibold text-white">{source.name}</h3>
            <span className="rounded-full border border-white/[.05] bg-white/[.02] px-2 py-1 text-[7px] font-semibold uppercase tracking-wider text-[var(--althea-muted)]">
              {sourceLabel[source.source_type] || source.source_type}
            </span>
            <span className={`rounded-full border px-2 py-1 text-[7px] font-semibold uppercase tracking-wider ${meta.className}`}>{meta.label}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[8px] text-[var(--althea-muted)]">
            <span>{source.connection_type || 'sem conexão'}</span>
            <span>{source.event_count} evento(s)</span>
            <span>{source.error_count} erro(s)</span>
            <span>último: {dateTime(source.last_event_at)}</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {source.url && (
            <a href={source.url} target="_blank" rel="noreferrer" className="grid h-8 w-8 place-items-center rounded-lg border border-white/[.05] text-[var(--althea-muted)] hover:text-white" aria-label="Abrir origem">
              <ExternalLink size={12} />
            </a>
          )}
          <Link href={funnelHref} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[.055] px-3 text-[8px] font-semibold text-zinc-200 hover:border-white/[.1]">
            {source.onboarding_status === 'operational' ? 'Abrir' : 'Continuar'} <ChevronRight size={11} />
          </Link>
        </div>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[8px] text-[var(--althea-muted)]">Onboarding</span>
          <b className="text-[8px] text-zinc-300">{source.onboarding_progress}%</b>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[.04]">
          <div className="h-full rounded-full bg-[var(--althea-brand)]/75 transition-all" style={{ width: `${Math.max(0, Math.min(100, source.onboarding_progress))}%` }} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <CheckItem label="Registrada" done={source.checklist.registered} required />
        <CheckItem label="Conexão" done={source.checklist.connection} required />
        <CheckItem label="Credencial" done={source.checklist.ingestion_ready} required />
        <CheckItem label="Primeiro evento" done={source.checklist.first_event_received} required />
        <CheckItem label="Produto" done={source.checklist.product_linked} />
        <CheckItem label="Gateway" done={source.checklist.gateway_linked} />
        <CheckItem label="Controle remoto" done={source.checklist.remote_control_ready} />
      </div>

      {source.last_error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-400/12 bg-red-400/[.035] px-3 py-2 text-[8px] text-red-300">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" /> {source.last_error}
        </div>
      )}
    </div>
  )
}

function CheckItem({ label, done, required = false }: { label: string; done: boolean; required?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[7px] ${done ? 'border-[rgba(29,184,84,.12)] bg-[rgba(29,184,84,.04)] text-[#78d899]' : required ? 'border-white/[.055] bg-white/[.02] text-zinc-400' : 'border-white/[.04] bg-transparent text-[#56645d]'}`}>
      {done ? <Check size={9} /> : <CircleDot size={8} />}
      {label}{!required && !done ? ' · opcional' : ''}
    </span>
  )
}

function Metric({ icon: Icon, label, value, note, success = false, warning = false }: {
  icon: typeof Activity
  label: string
  value: number
  note: string
  success?: boolean
  warning?: boolean
}) {
  return (
    <div className="min-h-[112px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[9px] text-[var(--althea-muted)]">{label}</span>
        <Icon size={14} className={warning ? 'text-[#D4AF37]' : success ? 'text-[var(--althea-brand)]' : 'text-zinc-400'} />
      </div>
      <b className={`mt-3 block text-[22px] font-semibold ${warning ? 'text-[#D4AF37]' : 'text-white'}`}>{value}</b>
      <span className="mt-1 block text-[8px] text-[var(--althea-muted)]">{note}</span>
    </div>
  )
}

function InfrastructureLink({ href, icon: Icon, title, value, note }: {
  href: string
  icon: typeof Activity
  title: string
  value: string
  note: string
}) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3 transition hover:border-white/[.09]">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[rgba(29,184,84,.08)] bg-[rgba(29,184,84,.04)] text-[var(--althea-brand)]"><Icon size={13} /></span>
      <div className="min-w-0 flex-1"><b className="block text-[9px] text-zinc-200">{title}</b><span className="text-[8px] text-[var(--althea-muted)]">{note}</span></div>
      <b className="text-[10px] text-white">{value}</b>
      <ChevronRight size={11} className="text-[var(--althea-muted)]" />
    </Link>
  )
}
