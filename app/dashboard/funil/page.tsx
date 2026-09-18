'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { FunnelRemoteControl } from '@/components/funnel-remote-control'
import { Activity, Check, ChevronDown, Copy, Eye, ExternalLink, KeyRound, Layers, Link2, Loader2, Plus, Radio, RefreshCw, Send, ShieldCheck, Webhook, X, Zap } from 'lucide-react'

interface Funnel {
  id: string
  nome: string
  url: string | null
  endpoint: string | null
  status: string | null
  created_at: string | null
  last_communication: string | null
}

interface FunnelConnection {
  id: string
  funnel_id: string | null
  connection_type: string
  status: string
  config: Record<string, unknown>
  last_event_at: string | null
  health_status: string | null
  last_error: string | null
  event_count: number | null
  error_count: number | null
  connected_at: string | null
  updated_at: string
}

interface IntegrationEvent {
  id: string
  funnel_id: string | null
  event_type: string
  external_id: string | null
  status: string
  payload: Record<string, unknown>
  occurred_at: string
  created_at: string
  error_message: string | null
}

interface WebhookIntegration {
  id: string
  funnel_id: string | null
  name: string
  provider: string
  endpoint_key: string
  secret_prefix: string | null
  status: string
  event_count: number | null
  last_event_at: string | null
}

type ConnectionMethod = 'script' | 'webhook'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value)
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeUrl(value: string): string {
  const clean = value.trim()
  if (!clean) return ''
  return /^https?:\/\//i.test(clean) ? clean : `https://${clean}`
}

function eventSummary(event: IntegrationEvent): string {
  const payload = asRecord(event.payload)
  const candidate = payload.summary ?? payload.message ?? payload.page ?? payload.path ?? payload.source
  if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  return event.external_id ? `ID externo: ${event.external_id}` : 'Payload recebido e registrado'
}

function statusMeta(connection: FunnelConnection | null): { label: string; tone: string; dot: string } {
  const health = connection?.health_status?.toLowerCase()
  if (health === 'healthy') return { label: 'OPERACIONAL', tone: 'text-emerald-400', dot: 'bg-emerald-500' }
  if (health === 'degraded') return { label: 'DEGRADADO', tone: 'text-amber-400', dot: 'bg-amber-500' }
  if (health === 'unhealthy' || health === 'error') return { label: 'INSTÁVEL', tone: 'text-rose-400', dot: 'bg-rose-500' }
  return { label: 'AGUARDANDO EVENTO', tone: 'text-zinc-400', dot: 'bg-zinc-500' }
}

export default function FunilDominioPage() {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [selectedFunnelId, setSelectedFunnelId] = useState('')
  const [creatingNewFunnel, setCreatingNewFunnel] = useState(false)
  const [funnel, setFunnel] = useState<Funnel | null>(null)
  const [connection, setConnection] = useState<FunnelConnection | null>(null)
  const [events, setEvents] = useState<IntegrationEvent[]>([])
  const [webhook, setWebhook] = useState<WebhookIntegration | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [creatingWebhook, setCreatingWebhook] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [funnelName, setFunnelName] = useState('')
  const [pageLink, setPageLink] = useState('')
  const [externalId, setExternalId] = useState('')
  const [pixelId, setPixelId] = useState('')
  const [chatEnabled, setChatEnabled] = useState(true)
  const [method, setMethod] = useState<ConnectionMethod>('script')
  const [oneTimeToken, setOneTimeToken] = useState('')
  const [oneTimeEndpoint, setOneTimeEndpoint] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [webhookEndpoint, setWebhookEndpoint] = useState('')
  const [copied, setCopied] = useState('')

  const loadConfiguration = useCallback(async () => {
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) throw new Error('Sessão expirada. Faça login novamente.')

    const { data: funnelRows, error: funnelError } = await supabase.from('funnels').select('id,nome,url,endpoint,status,created_at,last_communication').eq('user_id', auth.user.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(100)
    if (funnelError) throw funnelError

    const list = (funnelRows ?? []) as Funnel[]
    setFunnels(list)
    const activeId = creatingNewFunnel ? '' : selectedFunnelId && list.some((item) => item.id === selectedFunnelId) ? selectedFunnelId : list[0]?.id ?? ''
    setSelectedFunnelId(activeId)
    const selected = list.find((item) => item.id === activeId) ?? null
    setFunnel(selected)

    if (!selected) {
      setConnection(null); setEvents([]); setWebhook(null); setFunnelName(''); setPageLink(''); setExternalId(''); setPixelId(''); setChatEnabled(true); setMethod('script')
      return
    }

    const [{ data: connectionData, error: connectionError }, { data: eventData, error: eventError }, { data: webhookData, error: webhookError }] = await Promise.all([
      supabase.from('funnel_connections').select('id,funnel_id,connection_type,status,config,last_event_at,health_status,last_error,event_count,error_count,connected_at,updated_at').eq('funnel_id', selected.id).eq('user_id', auth.user.id).order('created_at', { ascending: true }).limit(1).maybeSingle(),
      supabase.from('integration_events').select('id,funnel_id,event_type,external_id,status,payload,occurred_at,created_at,error_message').eq('funnel_id', selected.id).eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(10),
      supabase.from('webhook_integrations').select('id,funnel_id,name,provider,endpoint_key,secret_prefix,status,event_count,last_event_at').eq('funnel_id', selected.id).eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    if (connectionError) throw connectionError
    if (eventError) throw eventError
    if (webhookError) throw webhookError

    const nextConnection = (connectionData as FunnelConnection | null) ?? null
    const config = asRecord(nextConnection?.config)
    setConnection(nextConnection)
    setEvents((eventData ?? []) as IntegrationEvent[])
    setWebhook((webhookData as WebhookIntegration | null) ?? null)
    setFunnelName(selected.nome)
    setPageLink(selected.url ?? '')
    setExternalId(stringValue(config.external_funnel_id))
    setPixelId(stringValue(config.pixel_id))
    setChatEnabled(booleanValue(config.chat_enabled, true))
    setMethod(stringValue(config.connection_method) === 'webhook' ? 'webhook' : 'script')
  }, [creatingNewFunnel, selectedFunnelId, supabase])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try { await loadConfiguration() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível sincronizar os funis.') } finally { setRefreshing(false); setLoading(false) }
  }, [loadConfiguration])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!selectedFunnelId) return
    let active = true
    const channel = supabase.channel(`funnel-integration-${selectedFunnelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'integration_events', filter: `funnel_id=eq.${selectedFunnelId}` }, (payload) => {
        if (!active) return
        const next = payload.new as IntegrationEvent
        const previous = payload.old as Partial<IntegrationEvent>
        setEvents((current) => {
          if (payload.eventType === 'INSERT' && next?.id) return [next, ...current.filter((item) => item.id !== next.id)].slice(0, 10)
          if (payload.eventType === 'UPDATE' && next?.id) return current.map((item) => item.id === next.id ? next : item)
          if (payload.eventType === 'DELETE' && previous?.id) return current.filter((item) => item.id !== previous.id)
          return current
        })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'funnel_connections', filter: `funnel_id=eq.${selectedFunnelId}` }, (payload) => {
        if (!active || payload.eventType === 'DELETE') return
        setConnection(payload.new as FunnelConnection)
      }).subscribe()
    return () => { active = false; void supabase.removeChannel(channel) }
  }, [selectedFunnelId, supabase])

  function cancelNewFunnel() {
    setCreatingNewFunnel(false)
    setOneTimeToken('')
    setOneTimeEndpoint('')
    setWebhookSecret('')
    setWebhookEndpoint('')
    setError('')
    setSuccess('')
    void refresh()
  }

  async function copyValue(label: string, value: string) {
    if (!value) return
    try { await navigator.clipboard.writeText(value); setCopied(label); window.setTimeout(() => setCopied(''), 1600) } catch { setError('Não foi possível copiar o valor para a área de transferência.') }
  }

  async function createWebhookIntegration(funnelId: string) {
    setCreatingWebhook(true); setError(''); setSuccess('')
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('webhook-integrations', { body: { funnel_id: funnelId, name: funnelName.trim() || 'Webhook do Funil', provider: 'custom' } })
      if (invokeError) throw invokeError
      if (!data?.secret || !data?.endpoint) throw new Error('A integração não retornou a credencial esperada.')
      setWebhook(data.integration as WebhookIntegration); setWebhookSecret(String(data.secret)); setWebhookEndpoint(String(data.endpoint)); setSuccess('Webhook criado. Guarde o segredo: ele não será exibido novamente.')
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível criar o webhook.') } finally { setCreatingWebhook(false) }
  }

  async function provisionScriptCredential(funnelId: string) {
    try {
      const response = await fetch('/api/funnels/ingestion-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ funnel_id: funnelId }) })
      const body: unknown = await response.json().catch(() => ({}))
      const payload = asRecord(body)
      if (!response.ok) throw new Error(stringValue(payload.error) || 'Não foi possível gerar a credencial.')
      const ingestion = asRecord(payload.ingestion)
      setOneTimeToken(stringValue(ingestion.token)); setOneTimeEndpoint(stringValue(ingestion.endpoint || ingestion.event_endpoint || funnel?.endpoint))
      if (stringValue(ingestion.token)) setSuccess('Credencial criada. O segredo completo é exibido somente agora.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao gerar a credencial.') }
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true); setError(''); setSuccess('')
    const name = funnelName.trim(); const url = normalizeUrl(pageLink); const externalFunnelId = externalId.trim()
    if (!name) { setError('Informe o nome do funil.'); setSaving(false); return }
    if (!creatingNewFunnel && !externalFunnelId) { setError('Informe o ID do funil externo.'); setSaving(false); return }
    if (url) { try { new URL(url) } catch { setError('O link informado não é uma URL válida.'); setSaving(false); return } }

    try {
      let funnelId = selectedFunnelId
      if (!funnelId) {
        const response = await fetch('/api/funnels/provision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ name, url: url || null, connection_type: method }) })
        const body: unknown = await response.json().catch(() => ({})); const payload = asRecord(body)
        if (!response.ok) throw new Error(stringValue(payload.error) || 'Não foi possível criar o funil.')
        const provisionedFunnel = asRecord(payload.funnel); const ingestion = asRecord(payload.ingestion)
        funnelId = stringValue(provisionedFunnel.id)
        if (!funnelId) throw new Error('O provisionamento não retornou o ID do funil.')
        setCreatingNewFunnel(false); setSelectedFunnelId(funnelId); setOneTimeToken(stringValue(ingestion.token)); setOneTimeEndpoint(stringValue(ingestion.event_endpoint || ingestion.endpoint || provisionedFunnel.endpoint))
      }

      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user) throw new Error('Sessão expirada. Faça login novamente.')

      const { error: saveError } = await supabase.rpc('save_funnel_domain_connection', { p_funnel_id: funnelId, p_name: name, p_url: url || null, p_external_funnel_id: externalFunnelId || null, p_pixel_id: pixelId.trim() || null, p_chat_enabled: chatEnabled })
      if (saveError) throw saveError

      const existingConfig = asRecord(connection?.config)
      const { error: metadataError } = await supabase.from('funnel_connections').update({ connection_type: method, config: { ...existingConfig, connection_method: method, external_funnel_id: externalFunnelId || null, pixel_id: pixelId.trim() || null, chat_enabled: chatEnabled, updated_from: 'funnel_workspace' }, updated_at: new Date().toISOString() }).eq('funnel_id', funnelId).eq('user_id', auth.user.id)
      if (metadataError) throw metadataError

      setSuccess('Funil criado e ativado. A integração está persistida no backend.')
      await refresh()
      if (method === 'script' && !oneTimeToken) await provisionScriptCredential(funnelId)
      if (method === 'webhook' && !webhook) await createWebhookIntegration(funnelId)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao salvar o funil.') } finally { setSaving(false) }
  }

  const health = statusMeta(connection)
  const totalEvents = connection?.event_count ?? events.length
  const totalErrors = connection?.error_count ?? events.filter((event) => event.status.toLowerCase() === 'failed' || Boolean(event.error_message)).length
  const lastEvent = connection?.last_event_at ?? events[0]?.occurred_at ?? null
  const lastEventLabel = lastEvent ? new Date(lastEvent).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'

  if (loading) {
    return (
      <div className="w-full space-y-5">
        <div className="h-24 animate-pulse rounded-2xl border border-white/[.05] bg-[var(--althea-surface)]" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl border border-white/[.05] bg-[var(--althea-surface)]" />)}
        </div>
        <div className="h-[420px] animate-pulse rounded-2xl border border-white/[.05] bg-[var(--althea-surface)]" />
      </div>
    )
  }

  return (
    <div className="w-full space-y-5">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Operação de funis</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">Funis</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--althea-muted)]">
            Configure a conexão de cada funil, acompanhe os eventos recebidos e controle a infraestrutura sem duplicar a navegação da plataforma.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[.06] bg-[var(--althea-surface)] px-4 text-[10px] font-semibold text-[var(--althea-muted)] transition hover:text-white disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Atualizar
          </button>
          <button
            type="button"
            onClick={() => router.push('/funnels/new')}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--althea-brand)] px-4 text-[10px] font-bold text-[#06110a] shadow-[0_8px_28px_rgba(29,184,84,.14)] transition hover:brightness-110"
          >
            <Plus size={14} />
            Novo funil
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-400/15 bg-red-400/[.05] px-4 py-3 text-xs text-red-200">
          <div className="flex items-start gap-2"><X size={14} className="mt-0.5 shrink-0" /><span>{error}</span></div>
        </div>
      )}

      {success && (
        <div className="rounded-xl border border-[rgba(29,184,84,.16)] bg-[rgba(29,184,84,.055)] px-4 py-3 text-xs text-[#8edca5]">
          <div className="flex items-start gap-2"><Check size={14} className="mt-0.5 shrink-0" /><span>{success}</span></div>
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Funis" value={String(funnels.length)} />
        <MetricCard label="Status" value={health.label} tone={health.label === 'OPERACIONAL' ? 'brand' : health.label === 'DEGRADADO' ? 'warning' : 'muted'} />
        <MetricCard label="Eventos" value={String(totalEvents)} />
        <MetricCard label="Erros" value={String(totalErrors)} tone={totalErrors > 0 ? 'warning' : 'muted'} />
      </section>

      {!creatingNewFunnel && funnels.length > 0 && (
        <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
          <div className="grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)_auto] lg:items-center">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[.18em] text-[var(--althea-muted)]">Funil selecionado</p>
              <p className="mt-1 text-[10px] text-[#65756d]">{funnels.length} cadastrado{funnels.length === 1 ? '' : 's'}</p>
            </div>
            <div className="relative">
              <select
                value={selectedFunnelId}
                onChange={(event) => {
                  setSelectedFunnelId(event.target.value)
                  setError('')
                  setSuccess('')
                }}
                className="h-11 w-full appearance-none rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3 pr-9 text-xs text-white outline-none focus:border-[rgba(29,184,84,.28)]"
              >
                {funnels.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-[var(--althea-muted)]" />
            </div>
            <span className={'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[9px] font-semibold ' + (health.label === 'OPERACIONAL' ? 'border-[rgba(29,184,84,.16)] bg-[rgba(29,184,84,.055)] text-[var(--althea-brand)]' : health.label === 'DEGRADADO' ? 'border-[rgba(212,175,55,.16)] bg-[rgba(212,175,55,.055)] text-[#D4AF37]' : 'border-white/[.05] bg-[var(--althea-bg)] text-[var(--althea-muted)]')}>
              <span className={'h-1.5 w-1.5 rounded-full ' + health.dot} />
              {health.label}
            </span>
          </div>
        </section>
      )}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,.85fr)]">
        <form onSubmit={handleSave} className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5 sm:p-6">
          <div className="flex items-start gap-3 border-b border-white/[.05] pb-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[rgba(29,184,84,.10)] bg-[rgba(29,184,84,.055)] text-[var(--althea-brand)]">
              <ShieldCheck size={16} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-white">{creatingNewFunnel ? 'Criar novo funil' : 'Configuração do funil'}</h2>
              <p className="mt-1 text-[10px] leading-4 text-[var(--althea-muted)]">
                {creatingNewFunnel ? 'Crie o registro e prepare a conexão de eventos.' : 'Altere identidade, conexão, tracking e recursos do funil selecionado.'}
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-4">
            <Field label="Nome do funil *">
              <div className="relative">
                <Layers className="absolute left-3 top-3.5 h-3.5 w-3.5 text-[var(--althea-muted)]" />
                <input
                  required
                  value={funnelName}
                  onChange={(event) => setFunnelName(event.target.value)}
                  placeholder="Ex.: Funil Produto X"
                  className="althea-ds-input pl-9 text-sm"
                />
              </div>
            </Field>

            <Field label="Link da página">
              <div className="relative">
                <Link2 className="absolute left-3 top-3.5 h-3.5 w-3.5 text-[var(--althea-muted)]" />
                <input
                  type="url"
                  value={pageLink}
                  onChange={(event) => setPageLink(event.target.value)}
                  placeholder="https://seusite.com.br"
                  className="althea-ds-input pl-9 text-sm"
                />
              </div>
            </Field>

            {!creatingNewFunnel && (
              <Field label="ID do funil externo *">
                <div className="relative">
                  <span className="absolute left-3 top-3 text-xs font-bold text-[var(--althea-muted)]">#</span>
                  <input
                    required
                    value={externalId}
                    onChange={(event) => setExternalId(event.target.value)}
                    placeholder="ID do seu curso/funil"
                    className="althea-ds-input pl-9 text-sm"
                  />
                </div>
              </Field>
            )}

            <Field label="Método de conexão">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMethod('script')}
                  className={'flex items-center gap-2 rounded-xl border p-3 text-left transition ' + (method === 'script' ? 'border-[rgba(29,184,84,.22)] bg-[rgba(29,184,84,.07)]' : 'border-white/[.05] bg-[var(--althea-bg)]')}
                >
                  <KeyRound className={'h-4 w-4 ' + (method === 'script' ? 'text-[var(--althea-brand)]' : 'text-[var(--althea-muted)]')} />
                  <span><b className="block text-[10px] text-white">Script</b><small className="text-[8px] text-[var(--althea-muted)]">Credencial de eventos</small></span>
                </button>
                <button
                  type="button"
                  onClick={() => setMethod('webhook')}
                  className={'flex items-center gap-2 rounded-xl border p-3 text-left transition ' + (method === 'webhook' ? 'border-[rgba(29,184,84,.22)] bg-[rgba(29,184,84,.07)]' : 'border-white/[.05] bg-[var(--althea-bg)]')}
                >
                  <Webhook className={'h-4 w-4 ' + (method === 'webhook' ? 'text-[var(--althea-brand)]' : 'text-[var(--althea-muted)]')} />
                  <span><b className="block text-[10px] text-white">Webhook</b><small className="text-[8px] text-[var(--althea-muted)]">Endpoint de eventos</small></span>
                </button>
              </div>
            </Field>

            <Field label="Pixel / Tracking ID">
              <div className="relative">
                <Activity className="absolute left-3 top-3.5 h-3.5 w-3.5 text-[var(--althea-muted)]" />
                <input
                  value={pixelId}
                  onChange={(event) => setPixelId(event.target.value)}
                  placeholder="Opcional"
                  className="althea-ds-input pl-9 text-sm"
                />
              </div>
            </Field>

            <div className="flex items-center justify-between rounded-xl border border-white/[.05] bg-[var(--althea-bg)] px-3 py-3">
              <div>
                <span className="block text-[10px] font-semibold text-white">Chat do funil</span>
                <span className="text-[8px] text-[var(--althea-muted)]">Atendimento centralizado no CRM.</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={chatEnabled}
                onClick={() => setChatEnabled((value) => !value)}
                className={'h-5 w-9 rounded-full p-0.5 transition ' + (chatEnabled ? 'bg-[var(--althea-brand)]' : 'bg-[#27332d]')}
              >
                <span className={'block h-4 w-4 rounded-full bg-white shadow transition-transform ' + (chatEnabled ? 'translate-x-4' : 'translate-x-0')} />
              </button>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={saving || !funnelName.trim()}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--althea-brand)] px-4 text-[10px] font-bold text-[#06110a] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                {saving ? 'Salvando...' : creatingNewFunnel ? 'Criar e ativar' : 'Salvar alterações'}
              </button>
              {creatingNewFunnel && (
                <button type="button" onClick={cancelNewFunnel} disabled={saving} className="h-11 rounded-xl border border-white/[.06] px-4 text-[10px] font-semibold text-[var(--althea-muted)] hover:text-white">
                  Cancelar
                </button>
              )}
            </div>
          </div>
        </form>

        <div className="space-y-4">
          <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">Estado da integração</h2>
                <p className="mt-1 text-[10px] text-[var(--althea-muted)]">Monitoramento dos eventos e da conexão selecionada.</p>
              </div>
              <span className={'inline-flex items-center gap-1.5 text-[9px] font-semibold ' + health.tone}>
                <span className={'h-1.5 w-1.5 rounded-full ' + health.dot} />
                {health.label}
              </span>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <MiniMetric label="Eventos" value={String(totalEvents)} />
              <MiniMetric label="Erros" value={String(totalErrors)} warning={totalErrors > 0} />
              <MiniMetric label="Último" value={lastEventLabel} compact />
            </div>

            {oneTimeToken && (
              <div className="mt-4 space-y-2 rounded-xl border border-[rgba(29,184,84,.14)] bg-[rgba(29,184,84,.04)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--althea-brand)]">Credencial de ingestão</span>
                  <button type="button" onClick={() => copyValue('token', oneTimeToken)} className="flex items-center gap-1 text-[9px] text-[var(--althea-muted)] hover:text-white">
                    {copied === 'token' ? <Check size={12} /> : <Copy size={12} />} Copiar
                  </button>
                </div>
                <code className="block overflow-x-auto rounded-lg bg-black/20 p-2 text-[9px] text-[#8edca5]">{oneTimeToken}</code>
                {oneTimeEndpoint && <code className="block break-all text-[8px] text-[var(--althea-muted)]">{oneTimeEndpoint}</code>}
              </div>
            )}

            {webhookSecret && (
              <div className="mt-4 space-y-2 rounded-xl border border-[rgba(29,184,84,.14)] bg-[rgba(29,184,84,.04)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--althea-brand)]">Webhook criado</span>
                  <button type="button" onClick={() => copyValue('secret', webhookSecret)} className="flex items-center gap-1 text-[9px] text-[var(--althea-muted)] hover:text-white">
                    {copied === 'secret' ? <Check size={12} /> : <Copy size={12} />} Copiar segredo
                  </button>
                </div>
                <code className="block overflow-x-auto rounded-lg bg-black/20 p-2 text-[9px] text-[#8edca5]">{webhookSecret}</code>
                {webhookEndpoint && <code className="block break-all text-[8px] text-[var(--althea-muted)]">{webhookEndpoint}</code>}
              </div>
            )}

            {webhook && !webhookSecret && (
              <div className="mt-4 flex items-center justify-between rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3">
                <div>
                  <span className="block text-[9px] font-semibold text-white">Webhook</span>
                  <span className="text-[8px] text-[var(--althea-muted)]">{webhook.secret_prefix ? webhook.secret_prefix + '••••' : 'Credencial protegida'}</span>
                </div>
                <span className="text-[8px] font-semibold text-[var(--althea-brand)]">{webhook.status}</span>
              </div>
            )}

            {connection?.last_error && (
              <div className="mt-4 rounded-xl border border-red-400/12 bg-red-400/[.04] p-3 text-[9px] text-red-300">
                {connection.last_error}
              </div>
            )}
          </section>

          {!creatingNewFunnel && funnel?.url && (
            <section className="flex items-center gap-3 rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
              <Eye className="h-4 w-4 shrink-0 text-[var(--althea-muted)]" />
              <div className="min-w-0 flex-1">
                <span className="block text-[9px] font-semibold text-white">Página do funil</span>
                <span className="mt-1 block truncate text-[8px] text-[var(--althea-muted)]">{funnel.url}</span>
              </div>
              <a href={funnel.url} target="_blank" rel="noreferrer" aria-label="Abrir página do funil" className="grid h-9 w-9 place-items-center rounded-lg text-[var(--althea-muted)] hover:bg-white/[.03] hover:text-[var(--althea-brand)]">
                <ExternalLink size={15} />
              </a>
            </section>
          )}
        </div>
      </section>

      {!creatingNewFunnel && funnel && <FunnelRemoteControl funnelId={funnel.id} />}

      <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Eventos recentes</h2>
            <p className="mt-1 text-[10px] text-[var(--althea-muted)]">Eventos recebidos do funil selecionado.</p>
          </div>
          <span className="inline-flex items-center gap-1 text-[8px] font-semibold text-[var(--althea-brand)]"><Radio size={11} /> REALTIME</span>
        </div>

        {events.length === 0 ? (
          <div className="mt-4 grid min-h-[190px] place-items-center rounded-xl border border-dashed border-white/[.06] bg-[var(--althea-bg)] text-center">
            <div>
              <InboxIcon />
              <p className="mt-2 text-xs font-medium text-white">Nenhum evento ainda</p>
              <p className="mt-1 text-[9px] text-[var(--althea-muted)]">Depois da ativação, os eventos do seu funil aparecerão aqui.</p>
            </div>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-white/[.035] rounded-xl border border-white/[.045] bg-[var(--althea-bg)]">
            {events.map((event) => (
              <div key={event.id} className="px-4 py-3.5">
                <div className="flex items-center gap-2">
                  <span className={'h-1.5 w-1.5 rounded-full ' + (event.status.toLowerCase() === 'failed' || event.error_message ? 'bg-red-400' : 'bg-[var(--althea-brand)]')} />
                  <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-white">{event.event_type}</span>
                  <time className="shrink-0 text-[8px] text-[var(--althea-muted)]">{new Date(event.occurred_at || event.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                </div>
                <div className="mt-1 pl-3.5 text-[9px] leading-relaxed text-[var(--althea-muted)]">{eventSummary(event)}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-[10px] font-medium text-[var(--althea-muted)]">{label}{children}</label>
}

function MetricCard({ label, value, tone = 'muted' }: { label: string; value: string; tone?: 'brand' | 'warning' | 'muted' }) {
  const valueTone = tone === 'brand' ? 'text-[var(--althea-brand)]' : tone === 'warning' ? 'text-[#D4AF37]' : 'text-white'
  return (
    <article className="min-h-[112px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
      <p className="text-[10px] text-[var(--althea-muted)]">{label}</p>
      <strong className={'mt-4 block truncate text-[20px] font-semibold tracking-[-.03em] ' + valueTone}>{value}</strong>
    </article>
  )
}

function MiniMetric({ label, value, warning = false, compact = false }: { label: string; value: string; warning?: boolean; compact?: boolean }) {
  return (
    <div className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3">
      <span className="block text-[8px] uppercase tracking-wider text-[var(--althea-muted)]">{label}</span>
      <b className={'mt-2 block truncate font-semibold ' + (compact ? 'text-[10px]' : 'text-base') + (warning ? ' text-red-300' : ' text-white')}>{value}</b>
    </div>
  )
}

function InboxIcon() {
  return <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-xl border border-white/[.05] bg-[var(--althea-surface)] text-[var(--althea-brand)]"><Send className="h-3.5 w-3.5 rotate-[-20deg]" /></div>
}
