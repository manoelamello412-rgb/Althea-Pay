'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, CheckCircle2, ChevronDown, CirclePlus, Copy, ExternalLink, Globe2, KeyRound, Link2, Loader2, Radio, RefreshCw, ShieldCheck, TriangleAlert, Webhook, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type JsonRecord = Record<string, unknown>
type Funnel = { id: string; nome: string; url: string | null; endpoint: string | null; status: string | null; created_at: string | null; last_communication: string | null }
type FunnelConnection = { id: string; funnel_id: string | null; connection_type: string; status: string; config: JsonRecord; last_event_at: string | null; health_status: string | null; last_error: string | null; event_count: number | null; error_count: number | null; connected_at: string | null; updated_at: string }
type IntegrationEvent = { id: string; funnel_id: string | null; event_type: string; external_id: string | null; status: string; payload: JsonRecord; occurred_at: string; created_at: string; error_message: string | null }
type WebhookIntegration = { id: string; funnel_id: string | null; name: string; provider: string; endpoint_key: string; secret_prefix: string | null; status: string; event_count: number | null; last_event_at: string | null }
type Method = 'script' | 'webhook'

function record(value: unknown): JsonRecord { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {} }
function configString(config: JsonRecord, key: string) { const value = config[key]; return typeof value === 'string' ? value : '' }
function configBoolean(config: JsonRecord, key: string, fallback: boolean) { const value = config[key]; return typeof value === 'boolean' ? value : fallback }
function normalizeUrl(value: string) { const trimmed = value.trim(); if (!trimmed) return ''; return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}` }
function eventSummary(event: IntegrationEvent) { const payload = record(event.payload); const candidate = payload.summary ?? payload.message ?? payload.page ?? payload.path ?? payload.source; if (typeof candidate === 'string' && candidate.trim()) return candidate.trim(); return event.external_id ? `ID externo: ${event.external_id}` : 'Payload recebido e registrado' }
function healthMeta(connection: FunnelConnection | null) { const status = connection?.health_status?.toLowerCase(); if (status === 'healthy') return { label: 'OPERACIONAL', className: 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10', Icon: CheckCircle2 }; if (status === 'degraded') return { label: 'DEGRADADO', className: 'text-amber-400 border-amber-500/20 bg-amber-500/10', Icon: TriangleAlert }; if (status === 'unhealthy' || status === 'error') return { label: 'INSTÁVEL', className: 'text-rose-400 border-rose-500/20 bg-rose-500/10', Icon: XCircle }; return { label: 'AGUARDANDO EVENTO', className: 'text-zinc-400 border-zinc-700 bg-zinc-900/60', Icon: Radio } }

export default function FunnelDomainSettingsPage() {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [selectedFunnelId, setSelectedFunnelId] = useState('')
  const [funnel, setFunnel] = useState<Funnel | null>(null)
  const [connection, setConnection] = useState<FunnelConnection | null>(null)
  const [events, setEvents] = useState<IntegrationEvent[]>([])
  const [webhook, setWebhook] = useState<WebhookIntegration | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [provisioningCredential, setProvisioningCredential] = useState(false)
  const [creatingWebhook, setCreatingWebhook] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [funnelName, setFunnelName] = useState('')
  const [customDomain, setCustomDomain] = useState('')
  const [externalFunnelId, setExternalFunnelId] = useState('')
  const [pixelId, setPixelId] = useState('')
  const [chatEnabled, setChatEnabled] = useState(true)
  const [method, setMethod] = useState<Method>('script')
  const [oneTimeToken, setOneTimeToken] = useState('')
  const [oneTimeEndpoint, setOneTimeEndpoint] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [webhookEndpoint, setWebhookEndpoint] = useState('')
  const [copied, setCopied] = useState('')

  const loadConfiguration = useCallback(async () => {
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) { router.replace('/login'); return }
    const { data, error: funnelError } = await supabase.from('funnels').select('id,nome,url,endpoint,status,created_at,last_communication').eq('user_id', auth.user.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(100)
    if (funnelError) throw funnelError
    const list = (data ?? []) as Funnel[]
    setFunnels(list)
    const activeId = selectedFunnelId && list.some((item) => item.id === selectedFunnelId) ? selectedFunnelId : list[0]?.id || ''
    setSelectedFunnelId(activeId)
    const selected = list.find((item) => item.id === activeId) ?? null
    setFunnel(selected)
    if (!selected) { setConnection(null); setWebhook(null); setEvents([]); return }
    const [{ data: connectionData, error: connectionError }, { data: eventData, error: eventError }, { data: webhookData, error: webhookError }] = await Promise.all([
      supabase.from('funnel_connections').select('id,funnel_id,connection_type,status,config,last_event_at,health_status,last_error,event_count,error_count,connected_at,updated_at').eq('funnel_id', selected.id).eq('user_id', auth.user.id).order('created_at', { ascending: true }).limit(1).maybeSingle(),
      supabase.from('integration_events').select('id,funnel_id,event_type,external_id,status,payload,occurred_at,created_at,error_message').eq('funnel_id', selected.id).eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(10),
      supabase.from('webhook_integrations').select('id,funnel_id,name,provider,endpoint_key,secret_prefix,status,event_count,last_event_at').eq('funnel_id', selected.id).eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    if (connectionError) throw connectionError
    if (eventError) throw eventError
    if (webhookError) throw webhookError
    const nextConnection = (connectionData as FunnelConnection | null) ?? null
    const cfg = record(nextConnection?.config)
    setConnection(nextConnection)
    setWebhook((webhookData as WebhookIntegration | null) ?? null)
    setEvents((eventData ?? []) as IntegrationEvent[])
    setFunnelName(selected.nome)
    setCustomDomain(selected.url || '')
    setExternalFunnelId(configString(cfg, 'external_funnel_id'))
    setPixelId(configString(cfg, 'pixel_id'))
    setChatEnabled(configBoolean(cfg, 'chat_enabled', true))
    const configuredMethod = configString(cfg, 'connection_method')
    setMethod(configuredMethod === 'webhook' ? 'webhook' : 'script')
  }, [router, selectedFunnelId, supabase])

  const refresh = useCallback(async () => { setRefreshing(true); setError(''); try { await loadConfiguration() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível sincronizar a configuração do funil.') } finally { setRefreshing(false); setLoading(false) } }, [loadConfiguration])
  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!selectedFunnelId) return
    let active = true
    const channel = supabase.channel(`funnel-domain:${selectedFunnelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'integration_events', filter: `funnel_id=eq.${selectedFunnelId}` }, (payload) => {
        if (!active) return
        const next = payload.new as IntegrationEvent
        const previous = payload.old as Partial<IntegrationEvent>
        setEvents((current) => { if (payload.eventType === 'INSERT' && next?.id) return [next, ...current.filter((item) => item.id !== next.id)].slice(0, 10); if (payload.eventType === 'UPDATE' && next?.id) return current.map((item) => item.id === next.id ? next : item); if (payload.eventType === 'DELETE' && previous?.id) return current.filter((item) => item.id !== previous.id); return current })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'funnel_connections', filter: `funnel_id=eq.${selectedFunnelId}` }, (payload) => { if (active && payload.eventType !== 'DELETE') setConnection(payload.new as FunnelConnection) })
      .subscribe()
    return () => { active = false; void supabase.removeChannel(channel) }
  }, [selectedFunnelId, supabase])

  function selectFunnel(id: string) { setSelectedFunnelId(id); setOneTimeToken(''); setWebhookSecret(''); setError(''); setSuccess('') }
  function createNewFunnel() { setSelectedFunnelId(''); setFunnel(null); setConnection(null); setWebhook(null); setEvents([]); setFunnelName(''); setCustomDomain(''); setExternalFunnelId(''); setPixelId(''); setChatEnabled(true); setMethod('script'); setOneTimeToken(''); setWebhookSecret(''); setError(''); setSuccess('') }

  async function provisionCredential(funnelId: string) {
    setProvisioningCredential(true); setError(''); setSuccess('')
    try {
      const response = await fetch('/api/funnels/ingestion-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ funnel_id: funnelId }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Não foi possível gerar a credencial.')
      setOneTimeToken(body?.ingestion?.token || '')
      setOneTimeEndpoint(body?.ingestion?.endpoint || funnel?.endpoint || '')
      setSuccess('Credencial criada. Por segurança, o segredo completo é exibido somente agora.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao gerar a credencial.') } finally { setProvisioningCredential(false) }
  }

  async function createWebhookIntegration(funnelId: string) {
    setCreatingWebhook(true); setError(''); setSuccess('')
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('webhook-integrations', { body: { funnel_id: funnelId, name: funnelName.trim() || 'Webhook do Funil', provider: 'custom' } })
      if (invokeError) throw invokeError
      if (!data?.secret || !data?.endpoint) throw new Error('A integração foi criada sem retornar a credencial única.')
      setWebhook(data.integration as WebhookIntegration)
      setWebhookSecret(data.secret)
      setWebhookEndpoint(data.endpoint)
      setSuccess('Webhook criado. Guarde o segredo: ele não será exibido novamente.')
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível criar o webhook.') } finally { setCreatingWebhook(false) }
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return
    setSaving(true); setError(''); setSuccess('')
    const name = funnelName.trim(); const url = normalizeUrl(customDomain); const externalId = externalFunnelId.trim()
    if (!name || !externalId) { setError('Informe o nome do funil e o ID do funil externo.'); setSaving(false); return }
    if (url) { try { new URL(url) } catch { setError('O domínio informado não é uma URL válida.'); setSaving(false); return } }
    try {
      let funnelId = selectedFunnelId
      let provisionedToken = ''
      let provisionedEndpoint = ''
      if (!funnelId) {
        const response = await fetch('/api/funnels/provision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ name, url: url || null, connection_type: method }) })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Não foi possível provisionar o funil.')
        funnelId = body?.funnel?.id || ''
        provisionedToken = body?.ingestion?.token || ''
        provisionedEndpoint = body?.ingestion?.event_endpoint || body?.funnel?.endpoint || ''
        if (!funnelId) throw new Error('O provisionamento não retornou um ID de funil.')
        setSelectedFunnelId(funnelId)
        if (provisionedToken) { setOneTimeToken(provisionedToken); setOneTimeEndpoint(provisionedEndpoint) }
      }
      const { error: saveError } = await supabase.rpc('save_funnel_domain_connection', { p_funnel_id: funnelId, p_name: name, p_url: url || null, p_external_funnel_id: externalId, p_pixel_id: pixelId.trim() || null, p_chat_enabled: chatEnabled })
      if (saveError) throw saveError
      const existingConfig = record(connection?.config)
      const { error: metadataError } = await supabase.from('funnel_connections').update({ connection_type: method, config: { ...existingConfig, connection_method: method, external_funnel_id: externalId, pixel_id: pixelId.trim() || null, chat_enabled: chatEnabled, updated_from: 'integration_center' }, updated_at: new Date().toISOString() }).eq('funnel_id', funnelId).eq('user_id', (await supabase.auth.getUser()).data.user?.id || '')
      if (metadataError) throw metadataError
      setSuccess(method === 'webhook' ? 'Funil salvo. A integração Webhook está pronta para receber eventos autorizados.' : 'Funil salvo. A credencial de ingestão pode ser instalada no provedor do funil sem expor o código da ALTHEA PAY.')
      await refresh()
      if (method === 'webhook' && !webhook) await createWebhookIntegration(funnelId)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao ativar a integração.') } finally { setSaving(false) }
  }

  async function copyValue(label: string, value: string) { if (!value) return; try { await navigator.clipboard.writeText(value); setCopied(label); window.setTimeout(() => setCopied(''), 1500) } catch {} }
  const health = healthMeta(connection); const HealthIcon = health.Icon
  const eventCount = connection?.event_count ?? events.length
  const errorCount = connection?.error_count ?? events.filter((item) => item.status === 'failed' || item.error_message).length

  if (loading) return <div className="min-h-screen bg-[#060608] grid place-items-center text-zinc-500"><Loader2 size={22} className="animate-spin" /></div>

  return <div className="min-h-screen bg-[#060608] text-zinc-100 antialiased font-sans">
    <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-[#191921] bg-[#0b0b0f]/95 px-4 backdrop-blur sm:px-6"><button type="button" onClick={() => router.push('/dashboard/settings')} className="min-h-11 px-1 text-xs font-mono text-zinc-400 transition hover:text-white">← VOLTAR</button><div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-zinc-500"><Globe2 size={13} className="text-[#1DB854]" /> Funil e Domínio</div></header>
    <main className="mx-auto w-full max-w-6xl space-y-5 p-4 pb-32 sm:p-6 sm:pb-32">
      <section className="rounded-2xl border border-[#191921] bg-[#0b0b0f] p-4 sm:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><h1 className="text-xl font-bold tracking-tight text-white">Conectar Funil</h1><span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[9px] font-mono text-emerald-400">BACKEND REAL</span></div><p className="mt-1 max-w-2xl text-[11px] leading-5 text-zinc-500">O cliente opera a integração pelo painel. Credenciais ficam no backend e eventos reais entram no Supabase; nenhum usuário precisa acessar o código-fonte da ALTHEA PAY.</p></div><div className="flex gap-2"><button type="button" onClick={createNewFunnel} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#191921] bg-[#060608] px-3 text-[10px] font-mono text-zinc-400 hover:text-white"><CirclePlus size={14} /> NOVO FUNIL</button><button type="button" onClick={() => void refresh()} disabled={refreshing} className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-[#191921] bg-[#060608] text-zinc-400 hover:text-white disabled:opacity-50" aria-label="Atualizar"><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /></button></div></div>{funnels.length > 0 && <div className="relative mt-5"><label className="mb-1.5 block text-[10px] font-mono uppercase tracking-wider text-zinc-500">Ambiente do cliente</label><select value={selectedFunnelId} onChange={(e) => selectFunnel(e.target.value)} className="h-11 w-full appearance-none rounded-lg border border-[#191921] bg-[#060608] px-3 pr-10 text-xs text-white outline-none focus:border-zinc-600"><option value="">Criar novo funil</option>{funnels.map((item) => <option key={item.id} value={item.id}>{item.nome} · {item.id}</option>)}</select><ChevronDown size={15} className="pointer-events-none absolute right-3 bottom-3 text-zinc-600" /></div>}</section>
      {error && <div role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-[11px] text-rose-300">{error}</div>}{success && <div role="status" className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-[11px] text-emerald-300">{success}</div>}
      <form onSubmit={handleSave} className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
        <section className="rounded-2xl border border-[#191921] bg-[#0b0b0f] p-5"><div className="mb-5 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl border border-[#1DB854]/20 bg-[#0F1A16] text-[#1DB854]"><ShieldCheck size={17} /></span><div><h2 className="text-sm font-semibold text-white">Configuração operacional</h2><p className="text-[10px] text-zinc-600">Tudo salvo no ambiente do cliente.</p></div></div><div className="space-y-4"><Field label="Nome do Funil" value={funnelName} onChange={setFunnelName} placeholder="Minha Página de Vendas" required /><Field label="Link da Página" value={customDomain} onChange={setCustomDomain} placeholder="https://seusite.com.br" hint="A ALTHEA PAY não injeta código arbitrariamente em domínio de terceiros; a conexão depende do método suportado pelo provedor." /><Field label="ID do Funil Externo" value={externalFunnelId} onChange={setExternalFunnelId} placeholder="ID do seu curso/funil" hint="Usado para delimitar e validar os eventos recebidos." required mono />
          <div><label className="mb-2 block text-[10px] font-mono uppercase tracking-wider text-zinc-500">Método de conexão</label><div className="grid gap-2 sm:grid-cols-2"><MethodCard active={method === 'webhook'} icon={<Webhook size={17} />} title="Webhook" description="Sem código quando o provedor aceita webhook." onClick={() => setMethod('webhook')} /><MethodCard active={method === 'script'} icon={<KeyRound size={17} />} title="Credencial de eventos" description="Token seguro para plataformas com integração de eventos." onClick={() => setMethod('script')} /></div></div>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Pixel / Tracking ID" value={pixelId} onChange={setPixelId} placeholder="Opcional" mono /><Toggle label="Chat do Funil" checked={chatEnabled} onChange={setChatEnabled} /></div>
          <button type="submit" disabled={saving} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1DB854] px-4 text-xs font-bold text-black transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60">{saving ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />} {saving ? 'ATIVANDO...' : 'SALVAR E ATIVAR'}</button>
        </div></section>
        <aside className="space-y-5">
          <section className="rounded-2xl border border-[#191921] bg-[#0b0b0f] p-5"><div className="mb-4 flex items-center justify-between"><div><p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Credencial da conexão</p><p className="mt-1 text-sm font-semibold text-white">Sem acesso ao código</p></div><ShieldCheck size={17} className="text-[#1DB854]" /></div>{method === 'script' ? <><p className="text-[11px] leading-5 text-zinc-500">Gere uma credencial quando precisar conectar este funil. O segredo completo só aparece uma vez.</p><button type="button" disabled={!selectedFunnelId || provisioningCredential} onClick={() => selectedFunnelId && void provisionCredential(selectedFunnelId)} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#1DB854]/20 bg-[#0F1A16] px-3 text-[10px] font-mono text-[#1DB854] disabled:opacity-40">{provisioningCredential ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} {selectedFunnelId ? 'GERAR NOVA CREDENCIAL' : 'SALVE O FUNIL PRIMEIRO'}</button>{oneTimeToken && <SecretBox title="Token — exibição única" value={oneTimeToken} onCopy={() => void copyValue('token', oneTimeToken)} copied={copied === 'token'} />}{oneTimeEndpoint && <SecretBox title="Endpoint de eventos" value={oneTimeEndpoint} onCopy={() => void copyValue('endpoint', oneTimeEndpoint)} copied={copied === 'endpoint'} />}</> : <><p className="text-[11px] leading-5 text-zinc-500">O webhook é criado no backend e vinculado ao funil. O cliente só configura o endpoint e o segredo no provedor externo.</p><button type="button" disabled={!selectedFunnelId || creatingWebhook || Boolean(webhook?.status === 'active')} onClick={() => selectedFunnelId && void createWebhookIntegration(selectedFunnelId)} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#1DB854]/20 bg-[#0F1A16] px-3 text-[10px] font-mono text-[#1DB854] disabled:opacity-40">{creatingWebhook ? <Loader2 size={14} className="animate-spin" /> : <Webhook size={14} />} {webhook ? 'WEBHOOK ATIVO' : 'CRIAR WEBHOOK'}</button>{webhookSecret && <SecretBox title="Segredo — exibição única" value={webhookSecret} onCopy={() => void copyValue('webhook-secret', webhookSecret)} copied={copied === 'webhook-secret'} />}{webhookEndpoint && <SecretBox title="Endpoint do Webhook" value={webhookEndpoint} onCopy={() => void copyValue('webhook-endpoint', webhookEndpoint)} copied={copied === 'webhook-endpoint'} />}</>}</section>
          <section className="rounded-2xl border border-[#191921] bg-[#0b0b0f] p-5"><div className="mb-4 flex items-center justify-between"><div><p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Estado da integração</p><p className="mt-1 text-sm font-semibold text-white">Monitoramento em tempo real</p></div><span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-mono ${health.className}`}><HealthIcon size={12} /> {health.label}</span></div><div className="grid grid-cols-2 gap-2"><Metric label="EVENTOS" value={String(eventCount)} /><Metric label="ERROS" value={String(errorCount)} /><Metric label="ÚLTIMO EVENTO" value={connection?.last_event_at ? new Date(connection.last_event_at).toLocaleString('pt-BR') : '—'} /><Metric label="MÉTODO" value={method.toUpperCase()} /></div>{connection?.last_error && <div className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-[10px] text-rose-300">{connection.last_error}</div>}</section>
        </aside>
      </form>
      <section className="rounded-2xl border border-[#191921] bg-[#0b0b0f] p-5"><div className="mb-4 flex items-center gap-3"><Activity size={16} className="text-[#1DB854]" /><div><h2 className="text-sm font-semibold text-white">Eventos reais</h2><p className="text-[10px] text-zinc-600">Feed vindo de integration_events. Nenhum evento é simulado.</p></div></div>{events.length === 0 ? <div className="rounded-xl border border-dashed border-[#191921] p-6 text-center text-[11px] text-zinc-600">Aguardando o primeiro evento autorizado deste funil.</div> : <div className="space-y-2">{events.map((event) => <div key={event.id} className="flex items-center justify-between gap-4 rounded-xl border border-[#191921] bg-[#060608] p-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className="text-[10px] font-mono text-[#1DB854]">{event.event_type}</span><span className="text-[9px] text-zinc-700">{event.status}</span></div><p className="mt-1 truncate text-[11px] text-zinc-400">{eventSummary(event)}</p></div><span className="shrink-0 text-[9px] font-mono text-zinc-600">{new Date(event.created_at).toLocaleTimeString('pt-BR')}</span></div>)}</div>}{funnel?.url && <a href={funnel.url} target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-11 items-center gap-2 text-[10px] font-mono text-zinc-500 hover:text-white"><ExternalLink size={13} /> ABRIR PÁGINA CONECTADA</a>}</section>
      <section className="rounded-2xl border border-amber-500/10 bg-amber-500/[0.03] p-4 text-[10px] leading-5 text-zinc-500"><strong className="text-zinc-300">Importante:</strong> informar uma URL nunca concede à ALTHEA PAY permissão para modificar um site de terceiros. Quando o provedor oferece webhook, OAuth ou integração nativa, a conexão pode ser feita pelo painel sem programação. Para um site arbitrário, é necessária uma instalação/autorização única no próprio provedor; o cliente nunca recebe acesso ao código interno da ALTHEA PAY.</section>
    </main>
  </div>
}

function Field({ label, value, onChange, placeholder, hint, required, mono }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; hint?: string; required?: boolean; mono?: boolean }) { return <label className="block"><span className="mb-1.5 block text-[10px] font-mono uppercase tracking-wider text-zinc-500">{label}{required && <span className="text-[#1DB854]"> *</span>}</span><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} required={required} className={`h-11 w-full rounded-lg border border-[#191921] bg-[#060608] px-3 text-xs text-white outline-none placeholder:text-zinc-700 focus:border-zinc-600 ${mono ? 'font-mono' : ''}`} />{hint && <span className="mt-1.5 block text-[9px] leading-4 text-zinc-700">{hint}</span>}</label> }
function MethodCard({ active, icon, title, description, onClick }: { active: boolean; icon: React.ReactNode; title: string; description: string; onClick: () => void }) { return <button type="button" onClick={onClick} className={`min-h-20 rounded-xl border p-3 text-left transition ${active ? 'border-[#1DB854]/30 bg-[#0F1A16]' : 'border-[#191921] bg-[#060608] hover:border-zinc-700'}`}><div className={`mb-2 ${active ? 'text-[#1DB854]' : 'text-zinc-500'}`}>{icon}</div><p className="text-[11px] font-semibold text-white">{title}</p><p className="mt-1 text-[9px] leading-4 text-zinc-600">{description}</p></button> }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <button type="button" onClick={() => onChange(!checked)} className="flex min-h-11 items-center justify-between rounded-lg border border-[#191921] bg-[#060608] px-3 text-left"><span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{label}</span><span className={`h-5 w-9 rounded-full p-0.5 transition ${checked ? 'bg-[#1DB854]' : 'bg-zinc-800'}`}><span className={`block h-4 w-4 rounded-full bg-white transition ${checked ? 'translate-x-4' : ''}`} /></span></button> }
function SecretBox({ title, value, onCopy, copied }: { title: string; value: string; onCopy: () => void; copied: boolean }) { return <div className="mt-3 rounded-xl border border-[#1DB854]/15 bg-[#060608] p-3"><div className="mb-2 flex items-center justify-between gap-3"><p className="text-[9px] font-mono uppercase tracking-wider text-zinc-600">{title}</p><button type="button" onClick={onCopy} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#191921] px-2 text-[9px] font-mono text-zinc-400 hover:text-white"><Copy size={12} /> {copied ? 'COPIADO' : 'COPIAR'}</button></div><code className="block break-all text-[9px] leading-4 text-zinc-400">{value}</code></div> }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-[#191921] bg-[#060608] p-3"><p className="text-[8px] font-mono tracking-wider text-zinc-600">{label}</p><p className="mt-1 truncate text-[11px] font-semibold text-zinc-300">{value}</p></div> }
