'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Link2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Inbound = {
  id: string
  name: string
  provider: string
  endpoint_key: string
  status: string
  secret_prefix: string | null
  last_used_at: string | null
  last_event_at: string | null
  event_count: number | null
  funnel_id: string | null
}

type Outbound = {
  id: string
  name: string
  endpoint_url: string
  events: string[]
  status: string
  max_attempts: number
  created_at: string
  updated_at?: string
}

type Delivery = {
  id: string
  webhook_id: string
  event_type: string
  status: string
  attempt: number
  response_code: number | null
  response_time_ms: number | null
  error_message: string | null
  created_at: string
  delivered_at: string | null
}

type Event = {
  id: string
  event_type: string
  status: string
  created_at: string
  processed_at: string | null
  retry_count: number | null
}

const EVENTS = ['transaction.approved', 'transaction.failed', 'transaction.refunded', 'transaction.chargeback']
const MASK = '••••••••••••••••••••••••••••••••'
const fmt = (value: string | null) => value
  ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value))
  : '—'
const badge = (status: string) =>
  status === 'active' || status === 'processed' || status === 'delivered'
    ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
    : status === 'failed' || status === 'dead_letter'
      ? 'border-red-400/20 bg-red-400/10 text-red-300'
      : 'border-amber-400/20 bg-amber-400/10 text-amber-300'

export default function WebhooksPage() {
  const router = useRouter()
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [inbound, setInbound] = useState<Inbound[]>([])
  const [outbound, setOutbound] = useState<Outbound[]>([])
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rotating, setRotating] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [showSecret, setShowSecret] = useState(false)
  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<string[]>(EVENTS.slice(0, 2))
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data: auth, error: authError } = await db.auth.getUser()
      if (authError || !auth.user) {
        router.replace('/login')
        return
      }
      const uid = auth.user.id
      const [i, o, d, e] = await Promise.all([
        db.from('webhook_integrations').select('id,name,provider,endpoint_key,status,secret_prefix,last_used_at,last_event_at,event_count,funnel_id').order('created_at', { ascending: false }).limit(200),
        db.from('outbound_webhooks').select('id,name,endpoint_url,events,status,max_attempts,created_at,updated_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(200),
        db.from('outbound_webhook_deliveries').select('id,webhook_id,event_type,status,attempt,response_code,response_time_ms,error_message,created_at,delivered_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(100),
        db.from('integration_events').select('id,event_type,status,created_at,processed_at,retry_count').order('created_at', { ascending: false }).limit(100),
      ])
      if (i.error) throw i.error
      if (o.error) throw o.error
      if (d.error) throw d.error
      if (e.error) throw e.error
      setInbound((i.data ?? []) as Inbound[])
      setOutbound((o.data ?? []) as Outbound[])
      setDeliveries((d.data ?? []) as Delivery[])
      setEvents((e.data ?? []) as Event[])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a operação de webhooks.')
    } finally {
      setLoading(false)
    }
  }, [db, router])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    let cancelled = false
    const channels: ReturnType<typeof db.channel>[] = []
    void db.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return
      const uid = data.user.id
      for (const table of ['webhook_integrations', 'integration_events']) {
        const channel = db
          .channel(`webhooks-org-${table}`)
          .on('postgres_changes', { event: '*', schema: 'public', table }, () => void load())
          .subscribe()
        channels.push(channel)
      }
      for (const table of ['outbound_webhooks', 'outbound_webhook_deliveries']) {
        const channel = db
          .channel(`webhooks-user-${table}-${uid}`)
          .on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${uid}` }, () => void load())
          .subscribe()
        channels.push(channel)
      }
    })
    return () => {
      cancelled = true
      channels.forEach(channel => { void db.removeChannel(channel) })
    }
  }, [db, load])

  async function management(body: Record<string, unknown>) {
    const { data: { session } } = await db.auth.getSession()
    if (!session) throw new Error('Sessão expirada.')
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!base) throw new Error('Supabase não configurado no front.')
    const response = await fetch(`${base}/functions/v1/outbound-webhook-management`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || !result.ok) throw new Error(result.error || 'Operação recusada.')
    return result as Record<string, any>
  }

  async function createWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim() || !endpoint.trim() || selectedEvents.length === 0) return
    setSaving(true); setMessage(''); setError('')
    try {
      const result = await management({ action: 'create', name: name.trim(), endpoint_url: endpoint.trim(), events: selectedEvents })
      setSecret(typeof result.secret === 'string' ? result.secret : null)
      setShowSecret(true)
      setName(''); setEndpoint('')
      setMessage('Endpoint criado. O segredo é exibido somente agora.')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao criar endpoint.')
    } finally {
      setSaving(false)
    }
  }

  async function rotate(id: string) {
    setRotating(id); setMessage(''); setError('')
    try {
      const result = await management({ action: 'rotate', id })
      setSecret(typeof result.secret === 'string' ? result.secret : null)
      setShowSecret(true)
      setMessage('Segredo rotacionado. Atualize o consumidor.')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha na rotação.')
    } finally {
      setRotating(null)
    }
  }

  async function toggle(webhook: Outbound) {
    setMessage(''); setError('')
    try {
      await management({ action: 'toggle', id: webhook.id, status: webhook.status === 'active' ? 'disabled' : 'active' })
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao alterar status.')
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Remover este endpoint de saída?')) return
    setMessage(''); setError('')
    try {
      await management({ action: 'delete', id })
      setMessage('Endpoint removido.')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao remover endpoint.')
    }
  }

  async function copySecret() {
    if (!secret) return
    await navigator.clipboard.writeText(secret)
    setMessage('Segredo copiado para a área de transferência.')
  }

  const failedDeliveries = deliveries.filter(item => item.status === 'failed' || item.status === 'dead_letter').length
  const processedEvents = events.filter(item => item.status === 'processed').length

  return (
    <main className="min-h-screen bg-[#070A09] px-4 py-6 text-slate-100 lg:px-8">
      <div className="mx-auto max-w-[1700px] space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 text-[10px] font-black uppercase tracking-[.28em] text-emerald-400">ALTHEA PAY // WEBHOOKS</div>
            <h1 className="text-3xl font-black tracking-tight">Central de Webhooks</h1>
            <p className="mt-1 text-sm text-slate-500">Entrada, saída, provisionamento, segredos e telemetria em uma única área.</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[.03] px-4 text-sm font-semibold disabled:opacity-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''}/> Sincronizar
          </button>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Entradas', inbound.length],
            ['Saídas', outbound.length],
            ['Eventos processados', processedEvents],
            ['Entregas com falha', failedDeliveries],
          ].map(([label, value]) => (
            <article key={String(label)} className="rounded-2xl border border-white/10 bg-white/[.025] p-5">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">{label}</span>
              <strong className="mt-2 block text-2xl font-black">{value}</strong>
            </article>
          ))}
        </section>

        {(error || message) && (
          <div className={`rounded-xl border p-4 text-sm ${error ? 'border-red-400/20 bg-red-400/5 text-red-300' : 'border-emerald-400/20 bg-emerald-400/5 text-emerald-300'}`}>
            {error || message}
          </div>
        )}

        <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
          <form onSubmit={createWebhook} className="rounded-2xl border border-white/10 bg-white/[.02] p-5">
            <div className="flex items-center gap-3"><Link2 size={19} className="text-emerald-400"/><div><h2 className="font-black">Novo webhook de saída</h2><p className="text-xs text-slate-600">Provisionado pelo backend e assinado por segredo.</p></div></div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <input required value={name} onChange={event => setName(event.target.value)} placeholder="Nome do endpoint" className="min-h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm outline-none" />
              <input required type="url" value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="https://sua-api.com/webhooks/althea" className="min-h-11 rounded-xl border border-white/10 bg-black/20 px-3 font-mono text-xs outline-none" />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {EVENTS.map(item => (
                <button key={item} type="button" onClick={() => setSelectedEvents(current => current.includes(item) ? current.filter(value => value !== item) : [...current, item])} className={`min-h-10 rounded-full border px-3 text-[10px] font-bold ${selectedEvents.includes(item) ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-white/10 text-slate-500'}`}>{item}</button>
              ))}
            </div>
            <button type="submit" disabled={saving || selectedEvents.length === 0} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 text-xs font-black text-black disabled:opacity-50">
              {saving ? <RefreshCw size={15} className="animate-spin"/> : <Check size={15}/>} {saving ? 'Provisionando...' : 'Cadastrar endpoint'}
            </button>
            <div className="mt-4 rounded-xl border border-white/[.07] bg-black/20 p-3">
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-slate-500">{secret && showSecret ? secret : MASK}</code>
                {secret && <><button type="button" onClick={() => setShowSecret(value => !value)} className="grid h-10 w-10 place-items-center text-slate-400">{showSecret ? <EyeOff size={15}/> : <Eye size={15}/>}</button><button type="button" onClick={() => void copySecret()} className="grid h-10 w-10 place-items-center text-slate-400"><Copy size={15}/></button></>}
              </div>
              <p className="mt-2 text-[10px] text-slate-600">O segredo só aparece após criação ou rotação; não é lido de volta do banco.</p>
            </div>
          </form>

          <section className="rounded-2xl border border-white/10 bg-white/[.02] p-5">
            <div className="mb-5 flex items-center gap-3"><ArrowDownToLine size={19} className="text-emerald-400"/><div><h2 className="font-black">Webhooks de entrada</h2><p className="text-xs text-slate-600">Integrações que recebem eventos externos.</p></div></div>
            {inbound.length === 0 ? <p className="py-10 text-center text-sm text-slate-600">Nenhuma integração de entrada cadastrada.</p> : <div className="space-y-2">{inbound.map(item => <div key={item.id} className="rounded-xl border border-white/[.07] bg-black/10 p-4"><div className="flex items-start justify-between gap-3"><div><b className="text-sm">{item.name}</b><p className="mt-1 font-mono text-[11px] text-slate-600">{item.endpoint_key}</p></div><span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${badge(item.status)}`}>{item.status}</span></div><div className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-slate-500"><span>Eventos <b className="block text-slate-300">{item.event_count ?? 0}</b></span><span>Último <b className="block text-slate-300">{fmt(item.last_event_at)}</b></span><span>Prefixo <b className="block text-slate-300">{item.secret_prefix || '—'}</b></span></div></div>)}</div>}
          </section>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[.02] p-5">
          <div className="mb-5 flex items-center gap-3"><ArrowUpFromLine size={19} className="text-emerald-400"/><div><h2 className="font-black">Webhooks de saída</h2><p className="text-xs text-slate-600">Gerencie os endpoints que recebem eventos da Althea.</p></div></div>
          {outbound.length === 0 ? <p className="py-10 text-center text-sm text-slate-600">Nenhum webhook de saída cadastrado.</p> : <div className="grid gap-3 xl:grid-cols-2">{outbound.map(item => <article key={item.id} className="rounded-xl border border-white/[.07] bg-black/10 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><b className="text-sm">{item.name}</b><p className="mt-1 truncate font-mono text-[11px] text-slate-600">{item.endpoint_url}</p></div><span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${badge(item.status)}`}>{item.status}</span></div><div className="mt-3 flex flex-wrap gap-2">{item.events.map(event => <span key={event} className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-slate-500">{event}</span>)}</div><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void toggle(item)} className="min-h-10 rounded-lg border border-white/10 px-3 text-[10px] font-bold text-slate-400">{item.status === 'active' ? 'Desativar' : 'Ativar'}</button><button type="button" onClick={() => void rotate(item.id)} disabled={rotating === item.id} className="min-h-10 rounded-lg border border-white/10 px-3 text-[10px] font-bold text-slate-400">{rotating === item.id ? 'Rotacionando...' : 'Rotacionar segredo'}</button><button type="button" onClick={() => void remove(item.id)} className="ml-auto grid h-10 w-10 place-items-center rounded-lg border border-red-400/20 text-red-300" aria-label="Remover webhook"><Trash2 size={14}/></button></div></article>)}</div>}
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[.02]">
            <div className="flex items-center gap-3 border-b border-white/10 p-5"><Activity size={19} className="text-emerald-400"/><div><h2 className="font-black">Entregas recentes</h2><p className="text-xs text-slate-600">Telemetria do dispatcher de saída.</p></div></div>
            {deliveries.slice(0, 12).length === 0 ? <p className="py-10 text-center text-sm text-slate-600">Nenhuma entrega registrada.</p> : <div className="divide-y divide-white/[.06]">{deliveries.slice(0, 12).map(item => <div key={item.id} className="p-4"><div className="flex items-center justify-between gap-3"><span><b className="block text-sm">{item.event_type}</b><small className="text-slate-600">{fmt(item.created_at)}</small></span><span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${badge(item.status)}`}>{item.status}</span></div><p className="mt-2 text-xs text-slate-500">HTTP {item.response_code ?? '—'} · {item.response_time_ms ?? '—'}ms · tentativa {item.attempt}</p>{item.error_message && <p className="mt-1 truncate text-xs text-red-300">{item.error_message}</p>}</div>)}</div>}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[.02] p-5">
            <div className="mb-4 flex items-center gap-3"><ShieldCheck size={19} className="text-emerald-400"/><div><h2 className="font-black">Eventos de integração</h2><p className="text-xs text-slate-600">Fila normalizada de eventos recebidos.</p></div></div>
            {events.length === 0 ? <p className="py-8 text-center text-sm text-slate-600">Nenhum evento recebido.</p> : <div className="space-y-2">{events.slice(0, 12).map(item => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/[.07] p-3"><span><b className="text-xs">{item.event_type}</b><small className="ml-2 text-[10px] text-slate-600">{fmt(item.created_at)}</small></span><span className="flex items-center gap-2 text-[10px] text-slate-500">{item.status === 'processed' ? <CheckCircle2 size={14} className="text-emerald-400"/> : item.status === 'failed' || item.status === 'dead_letter' ? <XCircle size={14} className="text-red-400"/> : <Activity size={14}/>} {item.status} · retry {item.retry_count ?? 0}</span></div>)}</div>}
          </div>
        </section>
      </div>
    </main>
  )
}
