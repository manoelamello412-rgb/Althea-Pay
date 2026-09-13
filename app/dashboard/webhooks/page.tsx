'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ArrowDownToLine, ArrowUpFromLine, CheckCircle2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Inbound = { id: string; name: string; provider: string; endpoint_key: string; status: string; secret_prefix: string | null; last_used_at: string | null; last_event_at: string | null; event_count: number | null; funnel_id: string | null }
type Outbound = { id: string; name: string; endpoint_url: string; events: string[]; status: string; max_attempts: number; created_at: string }
type Delivery = { id: string; webhook_id: string; event_type: string; status: string; attempt: number; response_code: number | null; response_time_ms: number | null; created_at: string; delivered_at: string | null }
type Event = { id: string; event_type: string; status: string; created_at: string; processed_at: string | null; retry_count: number | null }

const fmt = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value)) : '—'
const badge = (status: string) => status === 'active' || status === 'processed' || status === 'delivered' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : status === 'failed' || status === 'dead_letter' ? 'border-red-400/20 bg-red-400/10 text-red-300' : 'border-amber-400/20 bg-amber-400/10 text-amber-300'

export default function WebhooksPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [inbound, setInbound] = useState<Inbound[]>([])
  const [outbound, setOutbound] = useState<Outbound[]>([])
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data: auth } = await db.auth.getUser()
      if (!auth.user) { setInbound([]); setOutbound([]); setDeliveries([]); setEvents([]); return }
      const uid = auth.user.id
      const [i, o, d, e] = await Promise.all([
        db.from('webhook_integrations').select('id,name,provider,endpoint_key,status,secret_prefix,last_used_at,last_event_at,event_count,funnel_id').eq('user_id', uid).order('created_at', { ascending: false }).limit(200),
        db.from('outbound_webhooks').select('id,name,endpoint_url,events,status,max_attempts,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(200),
        db.from('outbound_webhook_deliveries').select('id,webhook_id,event_type,status,attempt,response_code,response_time_ms,created_at,delivered_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(100),
        db.from('integration_events').select('id,event_type,status,created_at,processed_at,retry_count').eq('user_id', uid).order('created_at', { ascending: false }).limit(100),
      ])
      if (i.error) throw i.error; if (o.error) throw o.error; if (d.error) throw d.error; if (e.error) throw e.error
      setInbound((i.data ?? []) as Inbound[]); setOutbound((o.data ?? []) as Outbound[]); setDeliveries((d.data ?? []) as Delivery[]); setEvents((e.data ?? []) as Event[])
    } catch (cause) { console.error('[ALTHEA-WEBHOOKS]', cause); setError('Não foi possível carregar a operação real de webhooks.') }
    finally { setLoading(false) }
  }, [db])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    let cancelled = false; const channels: ReturnType<typeof db.channel>[] = []
    void db.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return
      const uid = data.user.id
      for (const table of ['webhook_integrations', 'outbound_webhooks', 'outbound_webhook_deliveries', 'integration_events']) {
        const channel = db.channel(`webhooks-${table}-${uid}`).on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${uid}` }, () => void load()).subscribe()
        channels.push(channel)
      }
    })
    return () => { cancelled = true; channels.forEach(channel => { void db.removeChannel(channel) }) }
  }, [db, load])

  const failedDeliveries = deliveries.filter(item => item.status === 'failed').length
  const processedEvents = events.filter(item => item.status === 'processed').length
  const recentDeliveries = deliveries.slice(0, 12)

  return <main className="min-h-screen bg-[#070A09] px-4 py-6 text-slate-100 lg:px-8"><div className="mx-auto max-w-[1700px]">
    <header className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><div className="mb-2 text-[10px] font-black uppercase tracking-[.28em] text-emerald-400">ALTHEA PAY // WEBHOOKS</div><h1 className="text-3xl font-black tracking-tight">Webhooks</h1><p className="mt-1 text-sm text-slate-500">Entrada de eventos, integrações e entrega de eventos para sistemas externos.</p></div><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[.03] px-4 text-sm font-semibold hover:bg-white/[.06] disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''}/>Sincronizar</button></header>
    <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Entradas</span><strong className="mt-2 block text-2xl font-black">{inbound.length}</strong></article><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Saídas</span><strong className="mt-2 block text-2xl font-black">{outbound.length}</strong></article><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Eventos processados</span><strong className="mt-2 block text-2xl font-black">{processedEvents}</strong></article><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Entregas com falha</span><strong className="mt-2 block text-2xl font-black">{failedDeliveries}</strong></article></section>
    {error && <div className="mb-5 rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-300">{error}</div>}
    {loading ? <div className="flex min-h-72 items-center justify-center gap-3 text-sm text-slate-500"><RefreshCw size={20} className="animate-spin"/>Carregando telemetria real…</div> : <div className="grid gap-6 xl:grid-cols-2">
      <section className="rounded-2xl border border-white/10 bg-white/[.02] p-5"><div className="mb-5 flex items-center gap-3"><ArrowDownToLine size={19} className="text-emerald-400"/><div><h2 className="font-black">Webhooks de entrada</h2><p className="text-xs text-slate-600">Integrações que recebem eventos externos.</p></div></div>{inbound.length === 0 ? <p className="py-10 text-center text-sm text-slate-600">Nenhuma integração de entrada cadastrada.</p> : <div className="space-y-2">{inbound.map(item => <div key={item.id} className="rounded-xl border border-white/[.07] bg-black/10 p-4"><div className="flex items-start justify-between gap-3"><div><b className="text-sm">{item.name}</b><p className="mt-1 font-mono text-[11px] text-slate-600">{item.endpoint_key}</p></div><span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${badge(item.status)}`}>{item.status}</span></div><div className="mt-4 grid grid-cols-3 gap-3 text-xs"><span><small className="block text-slate-600">Eventos</small><b>{item.event_count ?? 0}</b></span><span><small className="block text-slate-600">Último evento</small><b>{fmt(item.last_event_at)}</b></span><span><small className="block text-slate-600">Prefixo</small><b>{item.secret_prefix || '—'}</b></span></div></div>)}</div>}</section>
      <section className="rounded-2xl border border-white/10 bg-white/[.02] p-5"><div className="mb-5 flex items-center gap-3"><ArrowUpFromLine size={19} className="text-emerald-400"/><div><h2 className="font-black">Webhooks de saída</h2><p className="text-xs text-slate-600">Eventos entregues aos seus sistemas externos.</p></div></div>{outbound.length === 0 ? <p className="py-10 text-center text-sm text-slate-600">Nenhum webhook de saída cadastrado.</p> : <div className="space-y-2">{outbound.map(item => <div key={item.id} className="rounded-xl border border-white/[.07] bg-black/10 p-4"><div className="flex items-start justify-between gap-3"><div><b className="text-sm">{item.name}</b><p className="mt-1 max-w-[34rem] truncate font-mono text-[11px] text-slate-600">{item.endpoint_url}</p></div><span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${badge(item.status)}`}>{item.status}</span></div><div className="mt-3 flex flex-wrap gap-2">{item.events.slice(0, 6).map(event => <span key={event} className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-slate-500">{event}</span>)}<span className="text-[10px] text-slate-600">até {item.max_attempts} tentativas</span></div></div>)}</div>}</section>
      <section className="xl:col-span-2 overflow-hidden rounded-2xl border border-white/10 bg-white/[.02]"><div className="flex items-center gap-3 border-b border-white/10 p-5"><Activity size={19} className="text-emerald-400"/><div><h2 className="font-black">Entrega recente</h2><p className="text-xs text-slate-600">Telemetria persistida das últimas entregas outbound.</p></div></div>{recentDeliveries.length === 0 ? <p className="py-10 text-center text-sm text-slate-600">Nenhuma entrega registrada.</p> : <div className="divide-y divide-white/[.06]">{recentDeliveries.map(item => <div key={item.id} className="grid gap-2 px-5 py-4 md:grid-cols-[1.4fr_140px_110px_120px] md:items-center"><span><b className="block text-sm">{item.event_type}</b><small className="text-slate-600">{fmt(item.created_at)}</small></span><span className={`w-fit rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${badge(item.status)}`}>{item.status}</span><span className="text-xs text-slate-500">HTTP {item.response_code ?? '—'} · {item.response_time_ms ?? '—'}ms</span><span className="text-xs text-slate-500">tentativa {item.attempt}</span></div>)}</div>}</section>
      <section className="rounded-2xl border border-white/10 bg-white/[.02] p-5"><div className="mb-4 flex items-center gap-3"><ShieldCheck size={19} className="text-emerald-400"/><div><h2 className="font-black">Eventos de integração</h2><p className="text-xs text-slate-600">Fila normalizada de eventos recebidos.</p></div></div>{events.length === 0 ? <p className="py-8 text-center text-sm text-slate-600">Nenhum evento recebido.</p> : <div className="space-y-2">{events.slice(0, 10).map(item => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/[.07] p-3"><span><b className="text-xs">{item.event_type}</b><small className="ml-2 text-[10px] text-slate-600">{fmt(item.created_at)}</small></span><span className="flex items-center gap-2 text-[10px] text-slate-500">{item.status === 'processed' ? <CheckCircle2 size={14} className="text-emerald-400"/> : item.status === 'failed' || item.status === 'dead_letter' ? <XCircle size={14} className="text-red-400"/> : <Activity size={14}/>} {item.status} · retry {item.retry_count ?? 0}</span></div>)}</div>}</section>
    </div>}
  </div></main>
}
