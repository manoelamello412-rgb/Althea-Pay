'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ChevronRight, Clock3, RefreshCw, Search, UserRound, UsersRound, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type LiveJourney = {
  session_id: string
  funnel_id: string
  session_key: string
  visitor_id: string | null
  customer_id: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  current_event_type: string | null
  current_step: string | null
  current_page_url: string | null
  source: string | null
  medium: string | null
  campaign: string | null
  device: Record<string, unknown>
  first_seen_at: string
  last_seen_at: string
  idle_seconds: number
  identified_at: string | null
}

type Funnel = { id: string; nome: string }
type EventRow = {
  id: string
  event_type: string
  original_event_type: string | null
  status: string
  occurred_at: string
  payload: Record<string, unknown>
  error_message: string | null
}

const activePaymentEvents = new Set(['checkout_started','checkout_identified','payment_created','pix_created','pix_displayed','pix_copied','payment_pending','payment_processing'])
const supportEvents = new Set(['chat_started','chat_message'])

function relative(seconds: number) {
  if (seconds < 10) return 'agora'
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}min`
}

function label(value: string | null) {
  return value ? value.replaceAll('_', ' ') : 'sem evento'
}

function customerLabel(row: LiveJourney) {
  return row.customer_name || row.customer_email || row.customer_phone || (row.visitor_id ? `Visitante ${row.visitor_id.slice(0, 8)}` : 'Visitante anônimo')
}

export default function LiveJourneysPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<LiveJourney[]>([])
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [selected, setSelected] = useState<LiveJourney | null>(null)
  const [events, setEvents] = useState<EventRow[]>([])
  const [query, setQuery] = useState('')
  const [funnelId, setFunnelId] = useState('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingTimeline, setLoadingTimeline] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    const auth = await supabase.auth.getUser()
    if (auth.error || !auth.data.user) {
      setError('Sessão expirada.')
      setLoading(false)
      setRefreshing(false)
      return
    }
    let journeysQuery = supabase
      .from('v_funnel_live_journeys')
      .select('session_id,funnel_id,session_key,visitor_id,customer_id,customer_name,customer_email,customer_phone,current_event_type,current_step,current_page_url,source,medium,campaign,device,first_seen_at,last_seen_at,idle_seconds,identified_at')
      .eq('user_id', auth.data.user.id)
      .order('last_seen_at', { ascending: false })
      .limit(500)
    if (funnelId !== 'all') journeysQuery = journeysQuery.eq('funnel_id', funnelId)

    const [journeys, funnelRows] = await Promise.all([
      journeysQuery,
      supabase.from('funnels').select('id,nome').eq('user_id', auth.data.user.id).is('deleted_at', null).order('nome'),
    ])
    if (journeys.error) setError(journeys.error.message)
    else { setRows((journeys.data ?? []) as LiveJourney[]); setError('') }
    if (!funnelRows.error) setFunnels((funnelRows.data ?? []) as Funnel[])
    setLoading(false)
    setRefreshing(false)
  }, [funnelId, supabase])

  const loadTimeline = useCallback(async (journey: LiveJourney) => {
    setLoadingTimeline(true)
    const result = await supabase
      .from('integration_events')
      .select('id,event_type,original_event_type,status,occurred_at,payload,error_message')
      .eq('funnel_id', journey.funnel_id)
      .eq('session_id', journey.session_key)
      .order('occurred_at', { ascending: false })
      .limit(100)
    if (result.error) setError(result.error.message)
    else setEvents((result.data ?? []) as EventRow[])
    setLoadingTimeline(false)
  }, [supabase])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    let active = true
    let channel: ReturnType<typeof supabase.channel> | null = null
    void supabase.auth.getUser().then(({ data }) => {
      if (!active || !data.user) return
      channel = supabase.channel(`live-journeys-${data.user.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'attribution_sessions', filter: `user_id=eq.${data.user.id}` }, () => void load(true))
        .subscribe()
    })
    const timer = window.setInterval(() => void load(true), 15000)
    return () => {
      active = false
      window.clearInterval(timer)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [load, supabase])

  useEffect(() => {
    if (selected) void loadTimeline(selected)
    else setEvents([])
  }, [selected, loadTimeline])

  const funnelMap = useMemo(() => new Map(funnels.map(item => [item.id, item.nome])), [funnels])
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter(row => [
      customerLabel(row), row.customer_email, row.customer_phone, row.visitor_id,
      row.current_event_type, row.current_step, row.source, row.campaign, funnelMap.get(row.funnel_id),
    ].filter(Boolean).join(' ').toLowerCase().includes(needle))
  }, [funnelMap, query, rows])

  const identified = rows.filter(row => Boolean(row.identified_at || row.customer_id || row.customer_email)).length
  const payments = rows.filter(row => activePaymentEvents.has(row.current_event_type || '')).length
  const support = rows.filter(row => supportEvents.has(row.current_event_type || '')).length

  return (
    <main className="min-h-screen bg-[var(--althea-bg)] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1700px] space-y-5">
        <header className="flex flex-col gap-4 border-b border-white/[.06] pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[var(--althea-brand)]">FUNIS / TEMPO REAL</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Jornadas ao vivo</h1>
            <p className="mt-1 max-w-3xl text-sm text-[var(--althea-muted)]">Sessões com atividade nos últimos 15 minutos. Visitantes anônimos permanecem na mesma jornada quando se identificam depois.</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={refreshing} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/[.07] bg-[var(--althea-surface)] px-4 text-xs text-zinc-300 disabled:opacity-50">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Atualizar
          </button>
        </header>

        {error && <div className="rounded-xl border border-rose-400/20 bg-rose-400/[.06] px-4 py-3 text-xs text-rose-200">{error}</div>}

        <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Metric icon={<UsersRound size={16} />} label="Sessões ativas" value={rows.length} />
          <Metric icon={<UserRound size={16} />} label="Identificadas" value={identified} />
          <Metric icon={<Activity size={16} />} label="Checkout / pagamento" value={payments} />
          <Metric icon={<Clock3 size={16} />} label="Em atendimento" value={support} />
        </section>

        <section className="rounded-2xl border border-white/[.06] bg-[var(--althea-surface)]">
          <div className="grid gap-3 border-b border-white/[.05] p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <label className="flex h-11 items-center gap-2 rounded-xl border border-white/[.06] bg-black/10 px-3">
              <Search size={15} className="text-[var(--althea-muted)]" />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar cliente, visitante, etapa, campanha..." className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--althea-muted)]" />
            </label>
            <select value={funnelId} onChange={event => setFunnelId(event.target.value)} className="h-11 rounded-xl border border-white/[.06] bg-[var(--althea-bg)] px-3 text-sm text-white outline-none">
              <option value="all">Todos os funis</option>
              {funnels.map(funnel => <option key={funnel.id} value={funnel.id}>{funnel.nome}</option>)}
            </select>
          </div>

          {loading ? (
            <div className="grid min-h-72 place-items-center text-sm text-[var(--althea-muted)]">Carregando sessões reais...</div>
          ) : filtered.length === 0 ? (
            <div className="grid min-h-72 place-items-center px-6 text-center">
              <div><Activity className="mx-auto h-6 w-6 text-[var(--althea-brand)]" /><p className="mt-3 text-sm font-medium">Nenhuma jornada ativa agora</p><p className="mt-1 text-xs text-[var(--althea-muted)]">Quando o Connector enviar eventos com session_id, as sessões aparecerão aqui.</p></div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left">
                <thead><tr className="border-b border-white/[.05] text-[9px] uppercase tracking-[.15em] text-[var(--althea-muted)]">
                  <th className="px-4 py-3">Cliente / visitante</th><th className="px-4 py-3">Funil</th><th className="px-4 py-3">Agora</th><th className="px-4 py-3">Etapa</th><th className="px-4 py-3">Origem</th><th className="px-4 py-3">Última atividade</th><th className="w-12" />
                </tr></thead>
                <tbody>{filtered.map(row => (
                  <tr key={row.session_id} onClick={() => setSelected(row)} className="cursor-pointer border-b border-white/[.035] text-xs transition hover:bg-white/[.025]">
                    <td className="px-4 py-4"><strong className="block max-w-[240px] truncate text-white">{customerLabel(row)}</strong><span className="mt-1 block max-w-[260px] truncate text-[10px] text-[var(--althea-muted)]">{row.customer_email || row.session_key}</span></td>
                    <td className="px-4 py-4 text-zinc-300">{funnelMap.get(row.funnel_id) || row.funnel_id}</td>
                    <td className="px-4 py-4"><span className="rounded-full border border-[rgba(29,184,84,.16)] bg-[rgba(29,184,84,.06)] px-2 py-1 text-[9px] font-semibold text-[var(--althea-brand)]">{label(row.current_event_type)}</span></td>
                    <td className="px-4 py-4 text-zinc-400">{row.current_step || row.current_page_url || '—'}</td>
                    <td className="px-4 py-4 text-zinc-400">{[row.source,row.campaign].filter(Boolean).join(' · ') || 'Direto / não informado'}</td>
                    <td className="px-4 py-4 text-zinc-400">{relative(Number(row.idle_seconds || 0))}</td>
                    <td className="px-4 py-4 text-right"><ChevronRight size={15} className="text-[var(--althea-muted)]" /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/65 backdrop-blur-sm" onClick={event => { if (event.currentTarget === event.target) setSelected(null) }}>
          <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-white/[.07] bg-[#090d0b] p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-[9px] uppercase tracking-[.17em] text-[var(--althea-muted)]">Jornada da sessão</p><h2 className="mt-1 text-xl font-semibold">{customerLabel(selected)}</h2><p className="mt-1 text-xs text-[var(--althea-muted)]">{funnelMap.get(selected.funnel_id) || selected.funnel_id}</p></div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-lg p-2 text-zinc-500 hover:bg-white/5 hover:text-white"><X size={18} /></button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <Detail label="Session ID" value={selected.session_key} />
              <Detail label="Visitor ID" value={selected.visitor_id || '—'} />
              <Detail label="Etapa atual" value={selected.current_step || '—'} />
              <Detail label="Evento atual" value={label(selected.current_event_type)} />
              <Detail label="Origem" value={[selected.source,selected.medium].filter(Boolean).join(' / ') || '—'} />
              <Detail label="Campanha" value={selected.campaign || '—'} />
            </div>

            <div className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-[.14em] text-zinc-400">Timeline</h3>
              {loadingTimeline ? <p className="mt-4 text-xs text-[var(--althea-muted)]">Carregando eventos...</p> : events.length === 0 ? <p className="mt-4 text-xs text-[var(--althea-muted)]">Nenhum evento correlacionado a esta sessão.</p> : <div className="mt-3 space-y-2">{events.map(event => (
                <article key={event.id} className="rounded-xl border border-white/[.05] bg-white/[.025] p-3">
                  <div className="flex items-center justify-between gap-3"><strong className="text-xs">{label(event.event_type)}</strong><time className="text-[9px] text-[var(--althea-muted)]">{new Date(event.occurred_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time></div>
                  <div className="mt-1 flex gap-2 text-[9px] text-[var(--althea-muted)]"><span>{event.status}</span>{event.original_event_type && event.original_event_type !== event.event_type && <span>origem: {event.original_event_type}</span>}</div>
                  {event.error_message && <p className="mt-2 text-[10px] text-rose-300">{event.error_message}</p>}
                </article>
              ))}</div>}
            </div>
          </aside>
        </div>
      )}
    </main>
  )
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <article className="rounded-2xl border border-white/[.06] bg-[var(--althea-surface)] p-4"><div className="flex items-center gap-2 text-[10px] text-[var(--althea-muted)]">{icon}{label}</div><strong className="mt-2 block text-2xl font-semibold">{value}</strong></article>
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/[.05] bg-white/[.025] p-3"><span className="text-[9px] uppercase tracking-wider text-[var(--althea-muted)]">{label}</span><strong className="mt-1 block break-all text-xs font-medium text-zinc-200">{value}</strong></div>
}
