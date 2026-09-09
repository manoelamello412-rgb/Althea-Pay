'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, Check, ChevronLeft, Copy, Eye, EyeOff, KeyRound, Link2, RefreshCw, ShieldCheck, Trash2, Webhook, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Webhook = { id: string; name: string; endpoint_url: string; events: string[]; status: string; max_attempts: number; created_at: string; updated_at: string }
type Delivery = { id: string; webhook_id: string; event_type: string; status: string; attempt: number; response_code: number | null; response_time_ms: number | null; error_message: string | null; created_at: string }

const MASK = '••••••••••••••••••••••••••••••••'
const EVENTS = ['transaction.approved', 'transaction.failed', 'transaction.refunded', 'transaction.chargeback']

export default function IntegracoesSettingsPage() {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rotating, setRotating] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [showSecret, setShowSecret] = useState(false)
  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [selectedEvents, setSelectedEvents] = useState(EVENTS.slice(0, 2))
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/login'); return }
    const [wh, dl] = await Promise.all([
      supabase.from('outbound_webhooks').select('id,name,endpoint_url,events,status,max_attempts,created_at,updated_at').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('outbound_webhook_deliveries').select('id,webhook_id,event_type,status,attempt,response_code,response_time_ms,error_message,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(30),
    ])
    if (wh.error) throw wh.error
    if (dl.error) throw dl.error
    setWebhooks((wh.data ?? []) as Webhook[])
    setDeliveries((dl.data ?? []) as Delivery[])
  }, [router, supabase])

  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : 'Não foi possível carregar as integrações.')).finally(() => setLoading(false)) }, [load])

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null
    let active = true
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (!active || !user) return
      channel = supabase.channel(`integration-general:${user.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'outbound_webhooks', filter: `user_id=eq.${user.id}` }, () => void load())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'outbound_webhook_deliveries', filter: `user_id=eq.${user.id}` }, (payload) => setDeliveries((current) => [payload.new as Delivery, ...current].slice(0, 30)))
        .subscribe()
    })
    return () => { active = false; if (channel) void supabase.removeChannel(channel) }
  }, [load, supabase])

  async function management(body: Record<string, unknown>) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Sessão expirada.')
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/outbound-webhook-management`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || !result.ok) throw new Error(result.error || 'Operação recusada.')
    return result
  }

  async function createWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage(''); setError('')
    try { const result = await management({ action: 'create', name, endpoint_url: endpoint, events: selectedEvents }); setWebhooks((current) => [result.webhook as Webhook, ...current]); setSecret(result.secret); setShowSecret(true); setName(''); setEndpoint(''); setMessage('Endpoint criado. O segredo foi exibido uma única vez.') }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao criar endpoint.') } finally { setSaving(false) }
  }

  async function rotate(id: string) {
    setRotating(id); setMessage(''); setError('')
    try { const result = await management({ action: 'rotate', id }); setSecret(result.secret); setShowSecret(true); setMessage('Segredo rotacionado. Atualize o consumidor.'); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha na rotação.') } finally { setRotating(null) }
  }

  async function toggle(webhook: Webhook) {
    setMessage(''); setError('')
    try { const result = await management({ action: 'toggle', id: webhook.id, status: webhook.status === 'active' ? 'disabled' : 'active' }); setWebhooks((current) => current.map((w) => w.id === webhook.id ? result.webhook : w)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao alterar status.') }
  }

  async function remove(id: string) {
    if (!window.confirm('Remover este endpoint e o histórico associado?')) return
    setMessage(''); setError('')
    try { await management({ action: 'delete', id }); setWebhooks((current) => current.filter((w) => w.id !== id)); setDeliveries((current) => current.filter((d) => d.webhook_id !== id)); setMessage('Endpoint removido.') }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao remover endpoint.') }
  }

  async function copy(value: string) { await navigator.clipboard.writeText(value); setMessage('Copiado para a área de transferência.') }

  if (loading) return <div className="flex min-h-[420px] items-center justify-center bg-[#060608] text-[#1DB854]"><RefreshCw className="animate-spin" size={20} /></div>

  return <div className="min-h-[500px] space-y-5 bg-[#060608] pb-32 font-['Space_Grotesk'] text-white">
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-[#191921] bg-[#0b0b0f]/95 px-1 backdrop-blur"><button type="button" onClick={() => window.dispatchEvent(new CustomEvent('althea-settings-back'))} className="flex min-h-11 items-center gap-1.5 text-xs font-bold text-zinc-400"><ChevronLeft size={16} className="text-[#1DB854]" />Voltar</button><span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-zinc-300"><Webhook size={15} className="text-[#1DB854]" />Integração Geral</span></header>
    <main className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <section className="space-y-5 lg:col-span-7">
        <div className="rounded-2xl border border-[#191921] bg-[#0b0b0f] p-4 sm:p-5"><div className="flex items-start gap-3"><KeyRound size={18} className="mt-0.5 text-[#1DB854]" /><div><h2 className="text-sm font-bold">Credenciais de Produção</h2><p className="mt-1 text-[10px] leading-relaxed text-zinc-500">Segredos nunca são inventados ou persistidos no navegador. A resolução de credenciais fica no backend/Vault.</p></div></div><div className="mt-4 flex items-center gap-2 rounded-xl border border-[#191921] bg-[#060608] p-3"><code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-500">{secret && showSecret ? secret : MASK}</code>{secret && <><button type="button" onClick={() => setShowSecret((v) => !v)} className="min-h-10 min-w-10 rounded-lg text-zinc-400 hover:text-white" aria-label="Alternar segredo">{showSecret ? <EyeOff size={16} /> : <Eye size={16} />}</button><button type="button" onClick={() => void copy(secret)} className="min-h-10 min-w-10 rounded-lg text-zinc-400 hover:text-white" aria-label="Copiar segredo"><Copy size={16} /></button></>}</div>{secret && <p className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-400"><ShieldCheck size={13} /> Segredo exibido somente após provisionamento/rotação.</p>}</div>
        <form onSubmit={createWebhook} className="rounded-2xl border border-[#191921] bg-[#0b0b0f] p-4 sm:p-5"><div className="flex items-start gap-3"><Link2 size={18} className="mt-0.5 text-[#1DB854]" /><div><h2 className="text-sm font-bold">Novo Endpoint de Webhook</h2><p className="mt-1 text-[10px] text-zinc-500">O endpoint recebe POSTs assinados por HMAC-SHA256.</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do endpoint" className="min-h-11 rounded-xl border border-[#191921] bg-[#060608] px-3 text-xs text-white outline-none focus:border-[#1DB854]/60" /><input type="url" required value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://sua-api.com/webhooks/althea" className="min-h-11 rounded-xl border border-[#191921] bg-[#060608] px-3 font-mono text-xs text-white outline-none focus:border-[#1DB854]/60" /></div><div className="mt-3 flex flex-wrap gap-2">{EVENTS.map((item) => <button key={item} type="button" onClick={() => setSelectedEvents((current) => current.includes(item) ? current.filter((x) => x !== item) : [...current, item])} className={`min-h-10 rounded-full border px-3 text-[10px] font-bold ${selectedEvents.includes(item) ? 'border-[#1DB854]/60 bg-[#1DB854]/10 text-[#1DB854]' : 'border-[#191921] text-zinc-500'}`}>{item}</button>)}</div><button type="submit" disabled={saving} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#1DB854] px-4 text-xs font-black text-black disabled:opacity-50">{saving ? <RefreshCw size={15} className="animate-spin" /> : <Check size={15} />} {saving ? 'Provisionando...' : 'Cadastrar Endpoint'}</button></form>
        <div className="space-y-2"><span className="pl-1 text-[10px] font-bold uppercase tracking-[.16em] text-zinc-500">Endpoints</span>{webhooks.length === 0 ? <div className="rounded-2xl border border-[#191921] bg-[#0b0b0f] p-5 text-xs text-zinc-600">Nenhum endpoint de saída configurado.</div> : webhooks.map((w) => <article key={w.id} className="rounded-2xl border border-[#191921] bg-[#0b0b0f] p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-bold">{w.name}</p><p className="mt-1 truncate font-mono text-[10px] text-zinc-500">{w.endpoint_url}</p></div><span className={`rounded-full border px-2 py-1 text-[9px] font-bold uppercase ${w.status === 'active' ? 'border-[#1DB854]/30 bg-[#1DB854]/10 text-[#1DB854]' : 'border-zinc-800 text-zinc-500'}`}>{w.status}</span></div><div className="mt-3 flex flex-wrap gap-2">{w.events.map((e) => <span key={e} className="rounded-md bg-[#060608] px-2 py-1 text-[9px] text-zinc-500">{e}</span>)}</div><div className="mt-3 flex gap-2"><button type="button" onClick={() => void toggle(w)} className="min-h-10 rounded-lg border border-[#191921] px-3 text-[10px] font-bold text-zinc-400">{w.status === 'active' ? 'Desativar' : 'Ativar'}</button><button type="button" onClick={() => void rotate(w.id)} disabled={rotating === w.id} className="flex min-h-10 items-center gap-1.5 rounded-lg border border-[#191921] px-3 text-[10px] font-bold text-zinc-400">{rotating === w.id ? <RefreshCw size={13} className="animate-spin" /> : <RefreshCw size={13} />} Rotacionar segredo</button><button type="button" onClick={() => void remove(w.id)} className="ml-auto min-h-10 min-w-10 rounded-lg border border-red-950/50 text-red-400" aria-label="Remover endpoint"><Trash2 size={14} className="mx-auto" /></button></div></article>)}</div>
      </section>
      <section className="lg:col-span-5"><div className="rounded-2xl border border-[#191921] bg-[#0b0b0f] p-4 sm:p-5 lg:sticky lg:top-20"><div className="flex items-center justify-between"><div><span className="font-mono text-[10px] text-[#1DB854]">[live]</span><h2 className="mt-1 text-sm font-bold">Monitor de Entregas</h2></div><span className="flex items-center gap-1.5 text-[9px] font-bold uppercase text-zinc-600"><span className="h-1.5 w-1.5 rounded-full bg-[#1DB854]" />Realtime</span></div><div className="mt-4 space-y-2">{deliveries.length === 0 ? <div className="flex gap-3 rounded-xl border border-[#191921] bg-[#060608] p-4"><AlertTriangle size={16} className="mt-0.5 text-zinc-600" /><p className="text-[10px] leading-relaxed text-zinc-600">Nenhuma entrega registrada pelo dispatcher.</p></div> : deliveries.map((d) => <div key={d.id} className="rounded-xl border border-[#191921] bg-[#060608] p-3"><div className="flex items-center justify-between gap-2"><span className="truncate text-[10px] font-bold text-zinc-300">{d.event_type}</span><span className={`rounded-md border px-2 py-1 text-[9px] font-bold ${d.status === 'delivered' ? 'border-[#1DB854]/30 bg-[#1DB854]/10 text-[#1DB854]' : d.status === 'retry' ? 'border-amber-900/30 bg-amber-950/20 text-amber-400' : 'border-red-900/30 bg-red-950/20 text-red-400'}`}>{d.response_code ?? '—'} · {d.status}</span></div><div className="mt-2 flex items-center justify-between text-[9px] text-zinc-600"><span>Tentativa {d.attempt}{d.response_time_ms != null ? ` · ${d.response_time_ms}ms` : ''}</span><span>{new Date(d.created_at).toLocaleString('pt-BR')}</span></div>{d.error_message && <p className="mt-2 truncate text-[9px] text-red-400">{d.error_message}</p>}</div>)}</div></div></section>
    </main>
    {(message || error) && <div className={`fixed bottom-24 left-3 right-3 z-40 flex items-center justify-between gap-3 rounded-xl border p-3 text-[10px] shadow-2xl ${error ? 'border-red-900/40 bg-red-950/90 text-red-200' : 'border-[#1DB854]/30 bg-[#0b0b0f]/95 text-[#1DB854]'}`} role="status"><span>{error || message}</span><button type="button" onClick={() => { setError(''); setMessage('') }}><X size={14} /></button></div>}
  </div>
}
