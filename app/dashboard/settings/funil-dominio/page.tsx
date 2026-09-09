'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, CheckCircle2, ChevronDown, CirclePlus, Copy, ExternalLink, Globe2, Loader2, Radio, RefreshCw, ShieldCheck, TriangleAlert, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type JsonRecord = Record<string, unknown>
type Funnel = { id: string; nome: string; url: string | null; endpoint: string | null; status: string | null; created_at: string | null; last_communication: string | null }
type FunnelConnection = { id: string; funnel_id: string | null; connection_type: string; status: string; config: JsonRecord; last_event_at: string | null; health_status: string | null; last_error: string | null; event_count: number | null; error_count: number | null; connected_at: string | null; updated_at: string }
type IntegrationEvent = { id: string; funnel_id: string | null; event_type: string; external_id: string | null; status: string; payload: JsonRecord; occurred_at: string; created_at: string; error_message: string | null }

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
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [funnelName, setFunnelName] = useState('')
  const [customDomain, setCustomDomain] = useState('')
  const [externalFunnelId, setExternalFunnelId] = useState('')
  const [pixelId, setPixelId] = useState('')
  const [chatEnabled, setChatEnabled] = useState(true)
  const [copiedEndpoint, setCopiedEndpoint] = useState(false)

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
    if (!selected) { setConnection(null); setEvents([]); return }
    const [{ data: connectionData, error: connectionError }, { data: eventData, error: eventError }] = await Promise.all([
      supabase.from('funnel_connections').select('id,funnel_id,connection_type,status,config,last_event_at,health_status,last_error,event_count,error_count,connected_at,updated_at').eq('funnel_id', selected.id).eq('user_id', auth.user.id).maybeSingle(),
      supabase.from('integration_events').select('id,funnel_id,event_type,external_id,status,payload,occurred_at,created_at,error_message').eq('funnel_id', selected.id).eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(10),
    ])
    if (connectionError) throw connectionError
    if (eventError) throw eventError
    const nextConnection = (connectionData as FunnelConnection | null) ?? null
    setConnection(nextConnection)
    setEvents((eventData ?? []) as IntegrationEvent[])
    setFunnelName(selected.nome)
    setCustomDomain(selected.url || '')
    setExternalFunnelId(configString(record(nextConnection?.config), 'external_funnel_id'))
    setPixelId(configString(record(nextConnection?.config), 'pixel_id'))
    setChatEnabled(configBoolean(record(nextConnection?.config), 'chat_enabled', true))
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

  function selectFunnel(id: string) { setSelectedFunnelId(id); setSuccess(''); setError('') }
  function createNewFunnel() { setSelectedFunnelId(''); setFunnel(null); setConnection(null); setEvents([]); setFunnelName(''); setCustomDomain(''); setExternalFunnelId(''); setPixelId(''); setChatEnabled(true); setSuccess(''); setError('') }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return
    setSaving(true); setError(''); setSuccess('')
    const name = funnelName.trim(); const url = normalizeUrl(customDomain); const externalId = externalFunnelId.trim()
    if (!name || !externalId) { setError('Informe o nome do funil e o ID do funil externo.'); setSaving(false); return }
    if (url) { try { new URL(url) } catch { setError('O domínio informado não é uma URL válida.'); setSaving(false); return } }
    try {
      let funnelId = selectedFunnelId
      if (!funnelId) {
        const response = await fetch('/api/funnels/provision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ name, url: url || null, connection_type: 'script' }) })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Não foi possível provisionar o funil.')
        funnelId = body?.funnel?.id || ''
        if (!funnelId) throw new Error('O provisionamento não retornou um ID de funil.')
        setSelectedFunnelId(funnelId)
      }
      const { error: saveError } = await supabase.rpc('save_funnel_domain_connection', { p_funnel_id: funnelId, p_name: name, p_url: url || null, p_external_funnel_id: externalId, p_pixel_id: pixelId.trim() || null, p_chat_enabled: chatEnabled })
      if (saveError) throw saveError
      setSuccess('Estrutura ativada. A conexão está pronta para receber eventos autorizados do seu funil.')
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao ativar o espelhamento.') } finally { setSaving(false) }
  }

  async function copyEndpoint() { if (!funnel?.endpoint) return; try { await navigator.clipboard.writeText(funnel.endpoint); setCopiedEndpoint(true); window.setTimeout(() => setCopiedEndpoint(false), 1500) } catch { setCopiedEndpoint(false) } }
  const health = healthMeta(connection); const HealthIcon = health.Icon

  if (loading) return <div className="min-h-screen bg-[#060608] grid place-items-center text-zinc-500"><Loader2 size={22} className="animate-spin" /></div>

  return <div className="min-h-screen bg-[#060608] text-zinc-100 antialiased font-sans">
    <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-[#191921] bg-[#0b0b0f]/95 px-4 backdrop-blur sm:px-6"><button type="button" onClick={() => router.push('/dashboard/settings')} className="min-h-11 px-1 text-xs font-mono text-zinc-400 transition hover:text-white">← VOLTAR</button><div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-zinc-500"><Globe2 size={13} className="text-[#1DB854]" /> Funil e Domínio</div></header>
    <main className="mx-auto w-full max-w-5xl space-y-5 p-4 pb-32 sm:p-6 sm:pb-32">
      <section className="rounded-2xl border border-[#191921] bg-[#0b0b0f] p-4 sm:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="text-xl font-bold tracking-tight text-white">Espelhamento do Funil</h1><p className="mt-1 max-w-2xl text-[11px] leading-5 text-zinc-500">Conecte sua página externa por contexto de eventos. A Althea Pay recebe eventos autorizados e espelha o estado operacional sem exigir código no painel.</p></div><div className="flex shrink-0 gap-2"><button type="button" onClick={createNewFunnel} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#191921] bg-[#060608] px-3 text-[10px] font-mono text-zinc-400 hover:text-white"><CirclePlus size={14} /> NOVO FUNIL</button><button type="button" onClick={() => void refresh()} disabled={refreshing} className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-[#191921] bg-[#060608] text-zinc-400 hover:text-white disabled:opacity-50" aria-label="Atualizar"><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /></button></div></div>{funnels.length > 0 && <div className="relative mt-5"><label className="mb-1.5 block text-[10px] font-mono uppercase tracking-wider text-zinc-500">Funil conectado</label><select value={selectedFunnelId} onChange={(e) => selectFunnel(e.target.value)} className="h-11 w-full appearance-none rounded-lg border border-[#191921] bg-[#060608] px-3 pr-10 text-xs text-white outline-none focus:border-zinc-600"><option value="">Criar novo funil</option>{funnels.map((item) => <option key={item.id} value={item.id}>{item.nome} · {item.id}</option>)}</select><ChevronDown size={15} className="pointer-events-none absolute right-3 bottom-3 text-zinc-600" /></div>}</section>
      {error && <div role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-[11px] text-rose-300">{error}</div>}{success && <div role="status" className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-[11px] text-emerald-300">{success}</div>}
      <form onSubmit={handleSave} className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
        <section className="rounded-2xl border border-[#191921] bg-[#0b0b0f] p-5"><div className="mb-5 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl border border-[#1DB854]/20 bg-[#0F1A16] text-[#1DB854]"><ShieldCheck size={17} /></span><div><h2 className="text-sm font-semibold text-white">Ativação de Estrutura</h2><p className="text-[10px] text-zinc-600">Configuração baseada em texto e contexto.</p></div></div><div className="space-y-4"><Field label="Apelido do Funil" value={funnelName} onChange={setFunnelName} placeholder="Minha Página de Vendas Principal" required /><Field label="Link da Página de Vendas" value={customDomain} onChange={setCustomDomain} placeholder="seusite.com.br" hint="HTTPS é acrescentado automaticamente quando omitido." /><Field label="ID do Funil Externo" value={externalFunnelId} onChange={setExternalFunnelId} placeholder="ID gerado pelo seu curso/funil" hint="Esse identificador delimita o contexto dos eventos recebidos." required mono /><div className="rounded-xl border border-[#191921] bg-[#060608] p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Endpoint de ingestão</p><p className="mt-1 max-w-[280px] truncate font-mono text-[10px] text-zinc-400">{funnel?.endpoint || 'Será gerado na ativação'}</p></div><button type="button" onClick={() => void copyEndpoint()} disabled={!funnel?.endpoint} className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-[#191921] px-2.5 text-[10px] text-zinc-500 hover:text-white disabled:opacity-40"><Copy size={13} />{copiedEndpoint ? 'COPIADO' : 'COPIAR'}</button></div></div></div></section>
        <section className="rounded-2xl border border-[#191921] bg-[#0b0b0f] p-5"><div className="mb-5 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl border border-[#191921] bg-[#060608] text-zinc-300"><Activity size={17} /></span><div><h2 className="text-sm font-semibold text-white">Rastreamento e Interatividade</h2><p className="text-[10px] text-zinc-600">Preferências persistidas na conexão.</p></div></div><div className="space-y-4"><Field label="ID do Pixel Meta/Google" value={pixelId} onChange={setPixelId} placeholder="ID do pixel" hint="O valor é armazenado como configuração do funil; a instalação no site continua sob seu controle." mono /><div className="flex items-center justify-between gap-4 rounded-xl border border-[#191921] bg-[#060608] p-3"><div><p className="text-xs font-medium text-zinc-200">Chat de suporte no checkout</p><p className="mt-1 text-[10px] leading-4 text-zinc-600">Habilita a preferência para a camada de checkout da Althea Pay.</p></div><button type="button" role="switch" aria-checked={chatEnabled} onClick={() => setChatEnabled((value) => !value)} className={`relative h-6 w-11 shrink-0 rounded-full p-0.5 transition ${chatEnabled ? 'bg-[#10b981]' : 'bg-zinc-800'}`}><span className={`block h-5 w-5 rounded-full bg-white transition-transform ${chatEnabled ? 'translate-x-5' : 'translate-x-0'}`} /></button></div><button type="submit" disabled={saving} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1DB854] px-4 text-xs font-bold text-black transition hover:brightness-110 disabled:opacity-60">{saving ? <><Loader2 size={15} className="animate-spin" /> CONECTANDO...</> : <><Radio size={15} /> ATIVAR E ESPELHAR ESTRUTURA DE VENDAS</>}</button></div></section>
      </form>
      <section className="overflow-hidden rounded-2xl border border-[#191921] bg-[#0b0b0f]"><div className="flex flex-col gap-3 border-b border-[#191921] p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-sm font-semibold text-white">Monitor de Captura de Fluxo</h2><p className="mt-1 text-[10px] text-zinc-600">Eventos reais recebidos pelo pipeline de ingestão, em tempo real.</p></div><div className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-bold ${health.className}`}><HealthIcon size={11} /> {health.label}</div></div><div className="grid grid-cols-2 border-b border-[#191921] sm:grid-cols-4"><Metric label="Eventos recebidos" value={String(connection?.event_count ?? 0)} /><Metric label="Erros" value={String(connection?.error_count ?? 0)} /><Metric label="Último evento" value={connection?.last_event_at ? new Date(connection.last_event_at).toLocaleTimeString('pt-BR') : '—'} /><Metric label="Canal" value={connection?.connection_type || '—'} /></div><div className="divide-y divide-[#191921]">{events.length === 0 ? <div className="p-8 text-center"><Radio size={18} className="mx-auto text-zinc-700" /><p className="mt-2 text-[11px] text-zinc-600">Aguardando transmissões do seu funil externo.</p><p className="mt-1 text-[10px] text-zinc-700">Nenhum evento foi inventado ou simulado.</p></div> : events.map((item) => <div key={item.id} className="grid gap-2 p-4 sm:grid-cols-[1fr_1.5fr_auto] sm:items-center"><div><div className="flex items-center gap-2"><span className="font-mono text-[10px] font-semibold text-zinc-300">{item.event_type}</span><span className="rounded-full border border-[#191921] px-1.5 py-0.5 text-[8px] uppercase text-zinc-600">{item.status}</span></div><p className="mt-1 text-[9px] text-zinc-600">{item.external_id || item.id}</p></div><p className="truncate text-[10px] text-zinc-500">{eventSummary(item)}</p><time className="font-mono text-[9px] text-zinc-600 sm:text-right">{new Date(item.occurred_at || item.created_at).toLocaleString('pt-BR')}</time></div>)}</div>{funnel?.url && <div className="border-t border-[#191921] p-4"><a href={funnel.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 text-[10px] font-mono text-zinc-500 hover:text-white"><ExternalLink size={13} /> ABRIR PÁGINA CONECTADA</a></div>}</section>
    </main>
  </div>
}

function Field({ label, value, onChange, placeholder, hint, required, mono }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; hint?: string; required?: boolean; mono?: boolean }) { return <label className="block space-y-1.5"><span className="block text-[10px] font-mono uppercase tracking-wider text-zinc-500">{label}{required ? ' *' : ''}</span><input required={required} type="text" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={`min-h-11 w-full rounded-lg border border-[#191921] bg-[#060608] px-3 text-xs text-white outline-none transition placeholder:text-zinc-700 focus:border-zinc-600 ${mono ? 'font-mono' : ''}`} />{hint && <span className="block text-[10px] leading-4 text-zinc-700">{hint}</span>}</label> }
function Metric({ label, value }: { label: string; value: string }) { return <div className="border-r border-[#191921] p-4 last:border-r-0"><span className="block text-[9px] font-mono uppercase tracking-wider text-zinc-700">{label}</span><strong className="mt-1 block truncate text-xs font-mono text-zinc-300">{value}</strong></div> }
