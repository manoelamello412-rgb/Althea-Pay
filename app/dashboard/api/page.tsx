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
        db.from('api_keys').select('id,name,key_prefix,scopes,expires_at,last_used_at,revoked_at,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(200),
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
      for (const table of ['api_keys', 'api_request_logs']) {
        const channel = db.channel(`api-${table}-${uid}`).on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${uid}` }, () => void load()).subscribe()
        channels.push(channel)
      }
    })
    return () => { cancelled = true; channels.forEach(channel => { void db.removeChannel(channel) }) }
  }, [db, load])

  const active = keys.filter(key => statusOf(key) === 'ativa').length
  const revoked = keys.filter(key => statusOf(key) !== 'ativa').length
  const successful = logs.filter(log => (log.status_code ?? 500) < 400).length
  const scopes = (value: unknown) => Array.isArray(value) ? value.map(String) : []

  return (
    <div className="w-full space-y-5">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Desenvolvedores</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">API</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--althea-muted)]">Credenciais, escopos e telemetria da API pública da operação.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center gap-2 self-start rounded-xl border border-white/[.06] bg-[var(--althea-surface)] px-4 text-[10px] font-semibold text-[var(--althea-muted)] transition hover:text-white disabled:opacity-50 lg:self-auto">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Metric label="Chaves ativas" value={String(active)} />
        <Metric label="Revogadas / expiradas" value={String(revoked)} />
        <Metric label="Requests registrados" value={String(logs.length)} />
      </section>

      <section className="rounded-2xl border border-[rgba(29,184,84,.10)] bg-[rgba(29,184,84,.035)] p-4">
        <div className="flex gap-3">
          <ShieldCheck size={17} className="mt-0.5 shrink-0 text-[var(--althea-brand)]" />
          <p className="text-[10px] leading-5 text-[var(--althea-muted)]">
            <b className="font-semibold text-white">Segurança:</b> a interface não consulta <code className="text-[var(--althea-brand)]">key_hash</code> nem tenta revelar credenciais secretas. Apenas prefixos e metadados permitidos são exibidos.
          </p>
        </div>
      </section>

      {error && <div className="rounded-xl border border-red-400/15 bg-red-400/[.05] p-4 text-xs text-red-200">{error}</div>}

      {loading ? (
        <div className="grid min-h-[300px] place-items-center rounded-2xl border border-white/[.055] bg-[var(--althea-surface)]">
          <RefreshCw size={20} className="animate-spin text-[var(--althea-brand)]" />
        </div>
      ) : (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)]">
          <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
            <div className="flex items-start gap-3">
              <KeyRound size={17} className="text-[var(--althea-brand)]" />
              <div>
                <h2 className="text-sm font-semibold text-white">Credenciais</h2>
                <p className="mt-1 text-[10px] text-[var(--althea-muted)]">Somente metadados seguros das chaves.</p>
              </div>
            </div>

            {keys.length === 0 ? (
              <div className="mt-4 grid min-h-[220px] place-items-center rounded-xl border border-dashed border-white/[.06] bg-[var(--althea-bg)] text-center">
                <div>
                  <KeyRound size={22} className="mx-auto text-[var(--althea-brand)] opacity-55" />
                  <p className="mt-3 text-xs font-medium text-white">Nenhuma chave de API cadastrada</p>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {keys.map(key => {
                  const status = statusOf(key)
                  return (
                    <div key={key.id} className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <b className="text-[10px] font-semibold text-white">{key.name}</b>
                          <p className="mt-1 font-mono text-[9px] text-[var(--althea-muted)]">{key.key_prefix}••••••</p>
                        </div>
                        <span className={'rounded-full border px-2 py-1 text-[8px] font-semibold uppercase ' + statusClass(status)}>{status}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {scopes(key.scopes).slice(0, 8).map(scope => <span key={scope} className="rounded-full border border-white/[.05] px-2 py-1 text-[8px] text-[var(--althea-muted)]">{scope}</span>)}
                        {scopes(key.scopes).length === 0 && <span className="text-[8px] text-[var(--althea-muted)]">Sem escopos informados</span>}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-[9px]">
                        <span><small className="block text-[var(--althea-muted)]">Criada</small><b className="mt-1 block font-medium text-white">{fmt(key.created_at)}</b></span>
                        <span><small className="block text-[var(--althea-muted)]">Último uso</small><b className="mt-1 block font-medium text-white">{fmt(key.last_used_at)}</b></span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </article>

          <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
            <div className="flex items-start gap-3">
              <Activity size={17} className="text-[var(--althea-brand)]" />
              <div>
                <h2 className="text-sm font-semibold text-white">Requests recentes</h2>
                <p className="mt-1 text-[10px] text-[var(--althea-muted)]">Auditoria operacional da API.</p>
              </div>
            </div>

            {logs.length === 0 ? (
              <div className="mt-4 grid min-h-[220px] place-items-center rounded-xl border border-dashed border-white/[.06] bg-[var(--althea-bg)] text-center">
                <p className="text-[10px] text-[var(--althea-muted)]">Nenhum request registrado.</p>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {logs.map(log => {
                  const ok = (log.status_code ?? 500) < 400
                  return (
                    <div key={log.id} className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3">
                      <div className="flex items-center gap-2">
                        <span className="rounded border border-white/[.05] px-2 py-1 font-mono text-[8px] text-[var(--althea-muted)]">{log.method}</span>
                        <b className="min-w-0 truncate text-[9px] font-medium text-white">{log.path}</b>
                        {ok ? <ShieldCheck size={13} className="ml-auto text-[var(--althea-brand)]" /> : <XCircle size={13} className="ml-auto text-red-300" />}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[8px] text-[var(--althea-muted)]">
                        <span>HTTP {log.status_code ?? '—'}</span>
                        <span>{log.latency_ms ?? '—'}ms</span>
                        <span>{log.scope || 'sem escopo'}</span>
                        <span>{fmt(log.created_at)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <p className="mt-4 text-[8px] text-[#5f6c65]">{successful} dos {logs.length} requests recentes tiveram status HTTP abaixo de 400.</p>
          </article>
        </section>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="min-h-[112px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
      <p className="text-[10px] text-[var(--althea-muted)]">{label}</p>
      <strong className="mt-4 block text-[24px] font-semibold tracking-[-.035em] text-white">{value}</strong>
    </article>
  )
}
