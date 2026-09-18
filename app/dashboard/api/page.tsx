'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, KeyRound, RefreshCw, ShieldCheck, XCircle } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type ApiKey = { id: string; name: string; key_prefix: string; scopes: unknown; expires_at: string | null; last_used_at: string | null; revoked_at: string | null; created_at: string }
type RequestLog = { id: string; api_key_id: string | null; request_id: string; method: string; path: string; status_code: number | null; latency_ms: number | null; scope: string | null; created_at: string }

const fmt = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value)) : '—'
const statusOf = (key: ApiKey) => key.revoked_at ? 'revogada' : key.expires_at && new Date(key.expires_at).getTime() <= Date.now() ? 'expirada' : 'ativa'
const statusClass = (status: string) => status === 'ativa' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : 'border-red-400/20 bg-red-400/10 text-red-300'

export default function ApiPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [logs, setLogs] = useState<RequestLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data: auth } = await db.auth.getUser()
      if (!auth.user) { setKeys([]); setLogs([]); return }
      const uid = auth.user.id
      const [keyResult, logResult] = await Promise.all([
        db.from('api_keys').select('id,name,key_prefix,scopes,expires_at,last_used_at,revoked_at,created_at').order('created_at', { ascending: false }).limit(200),
        db.from('api_request_logs').select('id,api_key_id,request_id,method,path,status_code,latency_ms,scope,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(100),
      ])
      if (keyResult.error) throw keyResult.error; if (logResult.error) throw logResult.error
      setKeys((keyResult.data ?? []) as ApiKey[]); setLogs((logResult.data ?? []) as RequestLog[])
    } catch (cause) { console.error('[ALTHEA-API]', cause); setError('Não foi possível carregar a operação real da API.') }
    finally { setLoading(false) }
  }, [db])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    let cancelled = false; const channels: ReturnType<typeof db.channel>[] = []
    void db.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return
      const uid = data.user.id
      const keysChannel = db.channel('api-keys-org').on('postgres_changes', { event: '*', schema: 'public', table: 'api_keys' }, () => void load()).subscribe()
      const logsChannel = db.channel(`api-request-logs-${uid}`).on('postgres_changes', { event: '*', schema: 'public', table: 'api_request_logs', filter: `user_id=eq.${uid}` }, () => void load()).subscribe()
      channels.push(keysChannel, logsChannel)
    })
    return () => { cancelled = true; channels.forEach(channel => { void db.removeChannel(channel) }) }
  }, [db, load])

  const active = keys.filter(key => statusOf(key) === 'ativa').length
  const revoked = keys.filter(key => statusOf(key) !== 'ativa').length
  const successful = logs.filter(log => (log.status_code ?? 500) < 400).length
  const scopes = (value: unknown) => Array.isArray(value) ? value.map(String) : []

  return <main className="min-h-screen bg-[#070A09] px-4 py-6 text-slate-100 lg:px-8"><div className="mx-auto max-w-[1700px]">
    <header className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><div className="mb-2 text-[10px] font-black uppercase tracking-[.28em] text-emerald-400">ALTHEA PAY // API</div><h1 className="text-3xl font-black tracking-tight">API</h1><p className="mt-1 text-sm text-slate-500">Credenciais, escopos e telemetria da API pública da operação.</p></div><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[.03] px-4 text-sm font-semibold hover:bg-white/[.06] disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''}/>Sincronizar</button></header>
    <section className="mb-6 grid gap-3 sm:grid-cols-3"><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Chaves ativas</span><strong className="mt-2 block text-2xl font-black">{active}</strong></article><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Chaves revogadas/expiradas</span><strong className="mt-2 block text-2xl font-black">{revoked}</strong></article><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Requests registrados</span><strong className="mt-2 block text-2xl font-black">{logs.length}</strong></article></section>
    <div className="mb-6 rounded-2xl border border-emerald-400/10 bg-emerald-400/[.025] p-4 text-sm text-slate-400"><div className="flex gap-3"><ShieldCheck size={19} className="mt-0.5 shrink-0 text-emerald-400"/><p><b className="text-slate-200">Segurança:</b> a interface nunca consulta <code className="text-emerald-300">key_hash</code> nem tenta revelar credenciais secretas. Ela exibe somente prefixos e metadados permitidos.</p></div></div>
    {error && <div className="mb-5 rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-300">{error}</div>}
    {loading ? <div className="flex min-h-72 items-center justify-center gap-3 text-sm text-slate-500"><RefreshCw size={20} className="animate-spin"/>Carregando dados reais…</div> : <div className="grid gap-6 xl:grid-cols-[1.05fr_.95fr]">
      <section className="rounded-2xl border border-white/10 bg-white/[.02] p-5"><div className="mb-5 flex items-center gap-3"><KeyRound size={19} className="text-emerald-400"/><div><h2 className="font-black">Credenciais</h2><p className="text-xs text-slate-600">Somente metadados seguros da chave.</p></div></div>{keys.length === 0 ? <p className="py-12 text-center text-sm text-slate-600">Nenhuma chave de API cadastrada.</p> : <div className="space-y-2">{keys.map(key => { const status = statusOf(key); return <div key={key.id} className="rounded-xl border border-white/[.07] bg-black/10 p-4"><div className="flex items-start justify-between gap-3"><div><b className="text-sm">{key.name}</b><p className="mt-1 font-mono text-xs text-slate-500">{key.key_prefix}••••••</p></div><span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${statusClass(status)}`}>{status}</span></div><div className="mt-4 flex flex-wrap gap-2">{scopes(key.scopes).slice(0, 8).map(scope => <span key={scope} className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-slate-500">{scope}</span>)}{scopes(key.scopes).length === 0 && <span className="text-[10px] text-slate-600">Sem escopos informados</span>}</div><div className="mt-3 grid grid-cols-2 gap-3 text-xs"><span><small className="block text-slate-600">Criada</small><b>{fmt(key.created_at)}</b></span><span><small className="block text-slate-600">Último uso</small><b>{fmt(key.last_used_at)}</b></span></div></div> })}</div>}</section>
      <section className="rounded-2xl border border-white/10 bg-white/[.02] p-5"><div className="mb-5 flex items-center gap-3"><Activity size={19} className="text-emerald-400"/><div><h2 className="font-black">Requests recentes</h2><p className="text-xs text-slate-600">Auditoria operacional da API.</p></div></div>{logs.length === 0 ? <p className="py-12 text-center text-sm text-slate-600">Nenhum request registrado.</p> : <div className="space-y-2">{logs.map(log => { const ok = (log.status_code ?? 500) < 400; return <div key={log.id} className="rounded-xl border border-white/[.07] p-3"><div className="flex items-center gap-2"><span className="rounded border border-white/10 px-2 py-1 font-mono text-[10px]">{log.method}</span><b className="min-w-0 truncate text-xs">{log.path}</b>{ok ? <ShieldCheck size={14} className="ml-auto text-emerald-400"/> : <XCircle size={14} className="ml-auto text-red-400"/>}</div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-600"><span>HTTP {log.status_code ?? '—'}</span><span>{log.latency_ms ?? '—'}ms</span><span>{log.scope || 'sem escopo'}</span><span>{fmt(log.created_at)}</span></div></div> })}</div>}<p className="mt-4 text-[10px] text-slate-700">{successful} dos {logs.length} requests recentes tiveram status HTTP abaixo de 400.</p></section>
    </div>}
  </div></main>
}
