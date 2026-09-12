'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import {
  Activity,
  Check,
  ChevronDown,
  Copy,
  Eye,
  ExternalLink,
  KeyRound,
  Layers,
  Link2,
  Loader2,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Webhook,
  X,
  Zap,
} from 'lucide-react'
import MobileBottomNav from '@/components/mobile-bottom-nav'

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

    const { data: funnelRows, error: funnelError } = await supabase
      .from('funnels')
      .select('id,nome,url,endpoint,status,created_at,last_communication')
      .eq('user_id', auth.user.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100)

    if (funnelError) throw funnelError

    const list = (funnelRows ?? []) as Funnel[]
    setFunnels(list)

    const activeId = creatingNewFunnel
      ? ''
      : selectedFunnelId && list.some((item) => item.id === selectedFunnelId)
        ? selectedFunnelId
        : list[0]?.id ?? ''

    setSelectedFunnelId(activeId)
    const selected = list.find((item) => item.id === activeId) ?? null
    setFunnel(selected)

    if (!selected) {
      setConnection(null)
      setEvents([])
      setWebhook(null)
      setFunnelName('')
      setPageLink('')
      setExternalId('')
      setPixelId('')
      setChatEnabled(true)
      setMethod('script')
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
    try {
      await loadConfiguration()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível sincronizar o funil.')
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }, [loadConfiguration])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!selectedFunnelId) return

    let active = true
    const channel = supabase
      .channel(`funnel-integration-${selectedFunnelId}`)
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
      })
      .subscribe()

    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [selectedFunnelId, supabase])

  function resetForNewFunnel() {
    setCreatingNewFunnel(true)
    setSelectedFunnelId('')
    setFunnel(null)
    setConnection(null)
    setWebhook(null)
    setEvents([])
    setFunnelName('')
    setPageLink('')
    setExternalId('')
    setPixelId('')
    setChatEnabled(true)
    setMethod('script')
    setOneTimeToken('')
    setOneTimeEndpoint('')
    setWebhookSecret('')
    setWebhookEndpoint('')
    setError('')
    setSuccess('')
  }

  async function copyValue(label: string, value: string) {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(label)
      window.setTimeout(() => setCopied(''), 1600)
    } catch {
      setError('Não foi possível copiar o valor para a área de transferência.')
    }
  }

  async function createWebhookIntegration(funnelId: string) {
    setCreatingWebhook(true)
    setError('')
    setSuccess('')
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('webhook-integrations', {
        body: { funnel_id: funnelId, name: funnelName.trim() || 'Webhook do Funil', provider: 'custom' },
      })
      if (invokeError) throw invokeError
      if (!data?.secret || !data?.endpoint) throw new Error('A integração não retornou a credencial esperada.')
      setWebhook(data.integration as WebhookIntegration)
      setWebhookSecret(String(data.secret))
      setWebhookEndpoint(String(data.endpoint))
      setSuccess('Webhook criado. Guarde o segredo: ele não será exibido novamente.')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar o webhook.')
    } finally {
      setCreatingWebhook(false)
    }
  }

  async function provisionScriptCredential(funnelId: string) {
    try {
      const response = await fetch('/api/funnels/ingestion-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ funnel_id: funnelId }),
      })
      const body: unknown = await response.json().catch(() => ({}))
      const payload = asRecord(body)
      if (!response.ok) throw new Error(stringValue(payload.error) || 'Não foi possível gerar a credencial.')
      const ingestion = asRecord(payload.ingestion)
      setOneTimeToken(stringValue(ingestion.token))
      setOneTimeEndpoint(stringValue(ingestion.endpoint || ingestion.event_endpoint || funnel?.endpoint))
      if (stringValue(ingestion.token)) setSuccess('Credencial criada. O segredo completo é exibido somente agora.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao gerar a credencial.')
    }
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return

    setSaving(true)
    setError('')
    setSuccess('')

    const name = funnelName.trim()
    const url = normalizeUrl(pageLink)
    const externalFunnelId = externalId.trim()

    if (!name || !externalFunnelId) {
      setError('Informe o nome do funil e o ID do funil externo.')
      setSaving(false)
      return
    }

    if (url) {
      try {
        new URL(url)
      } catch {
        setError('O link informado não é uma URL válida.')
        setSaving(false)
        return
      }
    }

    try {
      let funnelId = selectedFunnelId

      if (!funnelId) {
        const response = await fetch('/api/funnels/provision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ name, url: url || null, connection_type: method }),
        })
        const body: unknown = await response.json().catch(() => ({}))
        const payload = asRecord(body)
        if (!response.ok) throw new Error(stringValue(payload.error) || 'Não foi possível provisionar o funil.')

        const provisionedFunnel = asRecord(payload.funnel)
        const ingestion = asRecord(payload.ingestion)
        funnelId = stringValue(provisionedFunnel.id)
        if (!funnelId) throw new Error('O provisionamento não retornou o ID do funil.')

        setCreatingNewFunnel(false)
        setSelectedFunnelId(funnelId)
        setOneTimeToken(stringValue(ingestion.token))
        setOneTimeEndpoint(stringValue(ingestion.event_endpoint || ingestion.endpoint || provisionedFunnel.endpoint))
      }

      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user) throw new Error('Sessão expirada. Faça login novamente.')

      const { error: saveError } = await supabase.rpc('save_funnel_domain_connection', {
        p_funnel_id: funnelId,
        p_name: name,
        p_url: url || null,
        p_external_funnel_id: externalFunnelId,
        p_pixel_id: pixelId.trim() || null,
        p_chat_enabled: chatEnabled,
      })
      if (saveError) throw saveError

      const existingConfig = asRecord(connection?.config)
      const { error: metadataError } = await supabase
        .from('funnel_connections')
        .update({
          connection_type: method,
          config: {
            ...existingConfig,
            connection_method: method,
            external_funnel_id: externalFunnelId,
            pixel_id: pixelId.trim() || null,
            chat_enabled: chatEnabled,
            updated_from: 'funnel_connector',
          },
          updated_at: new Date().toISOString(),
        })
        .eq('funnel_id', funnelId)
        .eq('user_id', auth.user.id)

      if (metadataError) throw metadataError

      setSuccess(method === 'webhook'
        ? 'Funil salvo. O Webhook está preparado para receber eventos autorizados.'
        : 'Funil salvo. A credencial de ingestão pode ser instalada no seu funil.')

      await refresh()

      if (method === 'script' && !oneTimeToken) await provisionScriptCredential(funnelId)
      if (method === 'webhook' && !webhook) await createWebhookIntegration(funnelId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao ativar a integração.')
    } finally {
      setSaving(false)
    }
  }

  const health = statusMeta(connection)
  const totalEvents = connection?.event_count ?? events.length
  const totalErrors = connection?.error_count ?? events.filter((event) => event.status.toLowerCase() === 'failed' || Boolean(event.error_message)).length
  const lastEvent = connection?.last_event_at ?? events[0]?.occurred_at ?? null
  const lastEventLabel = lastEvent ? new Date(lastEvent).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'

  if (loading) {
    return (
      <div className="min-h-screen bg-[#020203] text-white grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-400" aria-label="Carregando" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#020203] pb-28 font-sans text-white antialiased selection:bg-emerald-500 selection:text-black">
      <header className="sticky top-0 z-50 h-14 border-b border-white/[0.05] bg-[#020203]/90 px-4 backdrop-blur-xl">
        <div className="mx-auto flex h-full max-w-md items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <img src="/althea-mark.png" alt="Althea Pay" className="h-6 w-6 shrink-0 object-contain" />
            <div className="h-4 w-px bg-white/[0.08]" />
            <span className="truncate text-[12px] font-semibold tracking-tight text-zinc-100">ALTHEA PAY <span className="text-zinc-600">//</span> FUNIL</span>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Buscar" className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/[0.04] hover:text-white">
              <Search className="h-[18px] w-[18px]" />
            </button>
            <button type="button" aria-label="Configurações" className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/[0.04] hover:text-white">
              <Settings className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md space-y-5 px-4 py-5">
        <section className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10">
              <Layers className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Funil</h1>
              <p className="text-[10px] text-zinc-600">Conector operacional</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={resetForNewFunnel} disabled={creatingNewFunnel} className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/[0.06] bg-[#0c0c0e] px-3 text-[10px] font-bold text-emerald-400 transition hover:border-emerald-500/20 disabled:cursor-default disabled:opacity-70">
              <Plus className="h-3 w-3" /> NOVO FUNIL
            </button>
            <button type="button" onClick={() => void refresh()} disabled={refreshing} aria-label="Atualizar" className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.06] bg-[#0c0c0e] text-zinc-400 transition hover:text-white disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </section>

        {funnels.length > 0 && (
          <section className="rounded-2xl border border-white/[0.05] bg-[#0c0c0e] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-zinc-500">Funis conectados</span>
              <span className="text-[9px] font-mono text-zinc-600">{funnels.length} total</span>
            </div>
            <div className="relative">
              <select value={selectedFunnelId} onChange={(event) => { setSelectedFunnelId(event.target.value); setError(''); setSuccess('') }} className="h-10 w-full appearance-none rounded-xl border border-white/[0.05] bg-[#121214] px-3 pr-9 text-xs text-zinc-200 outline-none focus:border-emerald-500/40">
                {funnels.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-zinc-600" />
            </div>
          </section>
        )}

        <section className="space-y-1 pl-1">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
            <h2 className="text-xs font-bold uppercase tracking-wide text-zinc-200">Conectar Funil</h2>
            <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-bold text-emerald-400">BACKEND REAL</span>
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-500">Conecte seu funil à Althea Pay por credencial de ingestão ou Webhook, sem expor a infraestrutura interna.</p>
        </section>

        {error && (
          <div className="rounded-xl border border-rose-500/25 bg-rose-950/20 p-3 text-xs text-rose-300">
            <div className="flex items-start gap-2"><X className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>
          </div>
        )}
        {success && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3 text-xs text-emerald-300">
            <div className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0" /><span>{success}</span></div>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4 rounded-2xl border border-white/[0.05] bg-[#0c0c0e] p-4 shadow-xl">
          <div className="flex items-center gap-2 border-b border-white/[0.04] pb-3">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <div>
              <h3 className="text-xs font-bold text-zinc-200">Configuração operacional</h3>
              <p className="text-[9px] font-mono text-zinc-500">Persistência no ambiente do cliente.</p>
            </div>
          </div>

          <label className="block space-y-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Nome do Funil *</span>
            <div className="relative"><Layers className="absolute left-3 top-3 h-3.5 w-3.5 text-zinc-600" /><input required value={funnelName} onChange={(event) => setFunnelName(event.target.value)} className="h-10 w-full rounded-xl border border-white/[0.04] bg-[#121214] pl-9 pr-3 text-xs font-mono text-zinc-200 outline-none focus:border-emerald-500/40" /></div>
          </label>

          <label className="block space-y-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Link da Página</span>
            <div className="relative"><Link2 className="absolute left-3 top-3 h-3.5 w-3.5 text-zinc-600" /><input type="url" value={pageLink} onChange={(event) => setPageLink(event.target.value)} placeholder="https://seusite.com.br" className="h-10 w-full rounded-xl border border-white/[0.04] bg-[#121214] pl-9 pr-3 text-xs font-mono text-zinc-200 outline-none focus:border-emerald-500/40" /></div>
          </label>

          <label className="block space-y-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">ID do Funil Externo *</span>
            <div className="relative"><span className="absolute left-3 top-2.5 text-xs font-bold text-zinc-600">#</span><input required value={externalId} onChange={(event) => setExternalId(event.target.value)} placeholder="ID do seu curso/funil" className="h-10 w-full rounded-xl border border-white/[0.04] bg-[#121214] pl-9 pr-3 text-xs font-mono text-zinc-200 outline-none focus:border-emerald-500/40" /></div>
          </label>

          <div className="space-y-2">
            <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-500">Método de Conexão</span>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMethod('script')} className={`flex items-center gap-2 rounded-xl border p-3 text-left transition ${method === 'script' ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : 'border-white/[0.04] bg-[#121214]'}`}>
                <KeyRound className={`h-4 w-4 ${method === 'script' ? 'text-emerald-400' : 'text-zinc-600'}`} />
                <span><b className="block text-[10px] text-zinc-200">Script</b><small className="text-[8px] text-zinc-600">Credencial de eventos</small></span>
              </button>
              <button type="button" onClick={() => setMethod('webhook')} className={`flex items-center gap-2 rounded-xl border p-3 text-left transition ${method === 'webhook' ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : 'border-white/[0.04] bg-[#121214]'}`}>
                <Webhook className={`h-4 w-4 ${method === 'webhook' ? 'text-emerald-400' : 'text-zinc-600'}`} />
                <span><b className="block text-[10px] text-zinc-200">Webhook</b><small className="text-[8px] text-zinc-600">Endpoint de eventos</small></span>
              </button>
            </div>
          </div>

          <label className="block space-y-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Pixel / Tracking ID</span>
            <div className="relative"><Activity className="absolute left-3 top-3 h-3.5 w-3.5 text-zinc-600" /><input value={pixelId} onChange={(event) => setPixelId(event.target.value)} placeholder="Opcional" className="h-10 w-full rounded-xl border border-white/[0.04] bg-[#121214] pl-9 pr-3 text-xs font-mono text-zinc-300 outline-none focus:border-emerald-500/40" /></div>
          </label>

          <div className="flex items-center justify-between rounded-xl border border-white/[0.04] bg-[#121214] px-3 py-2.5">
            <div><span className="block text-[10px] font-semibold text-zinc-200">Chat do Funil</span><span className="text-[8px] text-zinc-600">Atendimento centralizado no CRM.</span></div>
            <button type="button" role="switch" aria-checked={chatEnabled} onClick={() => setChatEnabled((value) => !value)} className={`h-5 w-9 rounded-full p-0.5 transition ${chatEnabled ? 'bg-emerald-500' : 'bg-zinc-800'}`}><span className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${chatEnabled ? 'translate-x-4' : 'translate-x-0'}`} /></button>
          </div>

          <button type="submit" disabled={saving || !funnelName.trim() || !externalId.trim()} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-bold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {saving ? 'SALVANDO...' : 'SALVAR E ATIVAR'}
          </button>
        </form>

        {(oneTimeToken || webhookSecret || funnel || connection) && (
          <section className="space-y-3 rounded-2xl border border-white/[0.05] bg-[#0c0c0e] p-4">
            <div className="flex items-center justify-between border-b border-white/[0.04] pb-3">
              <div className="flex items-center gap-2"><Radio className={`h-4 w-4 ${health.tone}`} /><div><h3 className="text-xs font-bold text-zinc-200">Estado da Integração</h3><p className="text-[9px] text-zinc-500">Monitoramento em tempo real.</p></div></div>
              <span className={`flex items-center gap-1.5 text-[9px] font-bold ${health.tone}`}><span className={`h-1.5 w-1.5 rounded-full ${health.dot} ${connection?.health_status === 'healthy' ? 'shadow-[0_0_7px_#10b981]' : ''}`} />{health.label}</span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-[#121214] p-3"><span className="block text-[8px] uppercase tracking-wider text-zinc-600">Eventos</span><b className="mt-1 block text-lg font-mono text-zinc-100">{totalEvents}</b></div>
              <div className="rounded-xl bg-[#121214] p-3"><span className="block text-[8px] uppercase tracking-wider text-zinc-600">Erros</span><b className={`mt-1 block text-lg font-mono ${totalErrors ? 'text-rose-400' : 'text-zinc-100'}`}>{totalErrors}</b></div>
              <div className="rounded-xl bg-[#121214] p-3"><span className="block text-[8px] uppercase tracking-wider text-zinc-600">Último evento</span><b className="mt-1 block truncate text-[11px] font-mono text-zinc-100">{lastEventLabel}</b></div>
            </div>

            {oneTimeToken && (
              <div className="space-y-2 rounded-xl border border-emerald-500/15 bg-emerald-950/10 p-3">
                <div className="flex items-center justify-between"><span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400">Credencial de ingestão</span><button type="button" onClick={() => copyValue('token', oneTimeToken)} className="flex items-center gap-1 text-[9px] text-zinc-500 hover:text-white">{copied === 'token' ? <Check size={12}/> : <Copy size={12}/>} Copiar</button></div>
                <code className="block overflow-x-auto rounded-lg bg-black/30 p-2 text-[9px] text-emerald-300">{oneTimeToken}</code>
                {oneTimeEndpoint && <div className="flex items-start gap-2"><span className="text-[8px] text-zinc-600">ENDPOINT</span><code className="break-all text-[8px] text-zinc-400">{oneTimeEndpoint}</code></div>}
              </div>
            )}

            {webhookSecret && (
              <div className="space-y-2 rounded-xl border border-emerald-500/15 bg-emerald-950/10 p-3">
                <div className="flex items-center justify-between"><span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400">Webhook criado</span><button type="button" onClick={() => copyValue('secret', webhookSecret)} className="flex items-center gap-1 text-[9px] text-zinc-500 hover:text-white">{copied === 'secret' ? <Check size={12}/> : <Copy size={12}/>} Copiar segredo</button></div>
                <code className="block overflow-x-auto rounded-lg bg-black/30 p-2 text-[9px] text-emerald-300">{webhookSecret}</code>
                {webhookEndpoint && <code className="block break-all text-[8px] text-zinc-400">{webhookEndpoint}</code>}
              </div>
            )}

            {webhook && !webhookSecret && (
              <div className="flex items-center justify-between rounded-xl bg-[#121214] p-3"><div><span className="block text-[9px] font-bold text-zinc-200">Webhook</span><span className="text-[8px] text-zinc-600">{webhook.secret_prefix ? `${webhook.secret_prefix}••••` : 'Credencial protegida'}</span></div><span className="text-[8px] font-bold text-emerald-400">{webhook.status}</span></div>
            )}

            {connection?.last_error && <div className="rounded-xl border border-rose-500/15 bg-rose-950/10 p-3 text-[9px] text-rose-300">{connection.last_error}</div>}
          </section>
        )}

        <section className="space-y-3 rounded-2xl border border-white/[0.05] bg-[#0c0c0e] p-4">
          <div className="flex items-center justify-between"><div><h3 className="text-xs font-bold text-zinc-200">Eventos Recentes</h3><p className="text-[9px] text-zinc-500">Eventos recebidos do seu funil.</p></div><span className="flex items-center gap-1 text-[8px] font-bold text-emerald-400"><Radio size={11}/> REALTIME</span></div>
          {events.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/[0.05] px-4 py-7 text-center"><InboxIcon /><p className="mt-2 text-xs text-zinc-400">Nenhum evento ainda</p><p className="mt-1 text-[9px] text-zinc-600">Depois da ativação, os eventos do seu funil aparecerão aqui.</p></div>
          ) : (
            <div className="space-y-1.5">
              {events.map((event) => (
                <div key={event.id} className="rounded-xl bg-[#121214] px-3 py-2.5">
                  <div className="flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${event.status.toLowerCase() === 'failed' || event.error_message ? 'bg-rose-500' : 'bg-emerald-500'}`} /><span className="min-w-0 flex-1 truncate text-[10px] font-bold text-zinc-200">{event.event_type}</span><time className="shrink-0 text-[8px] text-zinc-600">{new Date(event.occurred_at || event.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div>
                  <div className="mt-1 pl-3.5 text-[9px] leading-relaxed text-zinc-500">{eventSummary(event)}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <MobileBottomNav />
    </div>
  )
}

function InboxIcon() {
  return <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-xl bg-zinc-900 text-zinc-600"><Send className="h-3.5 w-3.5 rotate-[-20deg]" /></div>
}
