'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, CheckCircle2, KeyRound, Link2, Loader2, Network, RefreshCw, Save, ShieldCheck, XCircle } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type RemoteControl = {
  gateway_get_path?: string
  gateway_set_path?: string
  gateway_response_path?: string
  gateway_set_body?: Record<string, unknown>
  chat_enabled?: boolean
  chat_send_path?: string
  chat_message_id_path?: string
  chat_send_body?: Record<string, unknown>
}

type ConnectionState = {
  id: string
  remote_base_url: string | null
  remote_funnel_id: string | null
  write_enabled: boolean
  control_status: string | null
  last_error: string | null
  has_credential: boolean
  remote_control: RemoteControl
}

type Gateway = {
  id: string
  display_name: string | null
  provider: string
  environment: string
  status: string
}

type Mapping = {
  gateway_id: string
  remote_gateway_ref: string
}

type CommandRow = {
  id: string
  batch_id: string
  status: string
  target_gateway_id: string
  previous_gateway_id: string | null
  correlation_id: string
  last_error_message: string | null
  created_at: string
  verified_at: string | null
  completed_at: string | null
}

type DriftRow = {
  id: string
  status: string
  correlation_id: string
  expected_gateway_id: string | null
  observed_gateway_id: string | null
  observed_remote_gateway_ref: string | null
  detected_at: string
  last_seen_at: string
  resolved_at: string | null
}

type StateResponse = {
  ok?: boolean
  error?: string
  connection?: ConnectionState | null
  mappings?: Mapping[]
  gateways?: Gateway[]
}

function statusMeta(value: string | null | undefined) {
  const status = (value || 'read_only').toLowerCase()
  if (status === 'ready') return { label: 'PRONTO', tone: 'text-[var(--althea-brand)]', dot: 'bg-[var(--althea-brand)]' }
  if (status === 'syncing') return { label: 'SINCRONIZANDO', tone: 'text-sky-400', dot: 'bg-sky-500' }
  if (status === 'degraded') return { label: 'VALIDAR', tone: 'text-amber-400', dot: 'bg-amber-500' }
  if (status === 'error') return { label: 'ERRO', tone: 'text-rose-400', dot: 'bg-rose-500' }
  return { label: 'SOMENTE LEITURA', tone: 'text-[var(--althea-muted)]', dot: 'bg-zinc-500' }
}

function parseObject(value: string, label: string): Record<string, unknown> {
  const clean = value.trim()
  if (!clean) return {}
  const parsed: unknown = JSON.parse(clean)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(label + ' precisa ser um objeto JSON.')
  return parsed as Record<string, unknown>
}

export function FunnelRemoteControl({ funnelId }: { funnelId: string }) {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [connection, setConnection] = useState<ConnectionState | null>(null)
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [mappingRefs, setMappingRefs] = useState<Record<string, string>>({})
  const [commands, setCommands] = useState<CommandRow[]>([])
  const [drifts, setDrifts] = useState<DriftRow[]>([])
  const [remoteBaseUrl, setRemoteBaseUrl] = useState('')
  const [remoteFunnelId, setRemoteFunnelId] = useState('')
  const [token, setToken] = useState('')
  const [getPath, setGetPath] = useState('/funnels/{{remote_funnel_id}}/gateway')
  const [setPath, setSetPath] = useState('/funnels/{{remote_funnel_id}}/gateway')
  const [responsePath, setResponsePath] = useState('gateway_id')
  const [setBody, setSetBody] = useState('{"gateway_id":"{{target_remote_gateway_ref}}"}')
  const [chatEnabled, setChatEnabled] = useState(false)
  const [chatSendPath, setChatSendPath] = useState('/funnels/{{remote_funnel_id}}/conversations/{{remote_conversation_id}}/messages')
  const [chatMessageIdPath, setChatMessageIdPath] = useState('message_id')
  const [chatSendBody, setChatSendBody] = useState('{"message":"{{message_body}}"}')
  const [writeEnabled, setWriteEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [savingMappings, setSavingMappings] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!funnelId) return
    setLoading(true)
    setError('')
    try {
      const result = await db.functions.invoke('funnel-connection-control', {
        body: { action: 'state', funnel_id: funnelId },
      })
      if (result.error) throw new Error(result.error.message)
      const state = (result.data || {}) as StateResponse
      if (!state.ok) throw new Error(state.error || 'Falha ao carregar o controle remoto.')

      const next = state.connection || null
      setConnection(next)
      setGateways((state.gateways || []).filter(item => ['connected', 'degraded'].includes(item.status.toLowerCase())))
      setMappingRefs(Object.fromEntries((state.mappings || []).map(item => [item.gateway_id, item.remote_gateway_ref])))

      const [commandHistory, driftHistory] = await Promise.all([
        db
          .from('funnel_command_targets')
          .select('id,batch_id,status,target_gateway_id,previous_gateway_id,correlation_id,last_error_message,created_at,verified_at,completed_at')
          .eq('funnel_id', funnelId)
          .order('created_at', { ascending: false })
          .limit(5),
        db
          .from('funnel_control_drift_events')
          .select('id,status,correlation_id,expected_gateway_id,observed_gateway_id,observed_remote_gateway_ref,detected_at,last_seen_at,resolved_at')
          .eq('funnel_id', funnelId)
          .order('detected_at', { ascending: false })
          .limit(5),
      ])

      if (commandHistory.error) throw commandHistory.error
      if (driftHistory.error) throw driftHistory.error
      setCommands((commandHistory.data || []) as CommandRow[])
      setDrifts((driftHistory.data || []) as DriftRow[])

      if (next) {
        setRemoteBaseUrl(next.remote_base_url || '')
        setRemoteFunnelId(next.remote_funnel_id || '')
        setWriteEnabled(Boolean(next.write_enabled))
        setGetPath(next.remote_control?.gateway_get_path || '/funnels/{{remote_funnel_id}}/gateway')
        setSetPath(next.remote_control?.gateway_set_path || next.remote_control?.gateway_get_path || '/funnels/{{remote_funnel_id}}/gateway')
        setResponsePath(next.remote_control?.gateway_response_path || 'gateway_id')
        setSetBody(JSON.stringify(next.remote_control?.gateway_set_body || { gateway_id: '{{target_remote_gateway_ref}}' }, null, 2))
        setChatEnabled(Boolean(next.remote_control?.chat_enabled))
        setChatSendPath(next.remote_control?.chat_send_path || '/funnels/{{remote_funnel_id}}/conversations/{{remote_conversation_id}}/messages')
        setChatMessageIdPath(next.remote_control?.chat_message_id_path || 'message_id')
        setChatSendBody(JSON.stringify(next.remote_control?.chat_send_body || { message: '{{message_body}}' }, null, 2))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar o controle remoto.')
    } finally {
      setLoading(false)
    }
  }, [db, funnelId])

  useEffect(() => {
    setToken('')
    setMessage('')
    setError('')
    void load()
  }, [funnelId, load])

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      if (!remoteBaseUrl.trim()) throw new Error('Informe a URL base da API do funil.')
      if (!remoteFunnelId.trim()) throw new Error('Informe o ID remoto do funil.')
      if (!connection?.has_credential && !token.trim()) throw new Error('Informe a credencial da API.')

      const bodyTemplate = parseObject(setBody, 'Body da alteração')
      const chatBodyTemplate = parseObject(chatSendBody, 'Body do envio de chat')
      const credential = token.trim()
        ? { token: token.trim(), auth_header: 'Authorization', auth_prefix: 'Bearer' }
        : {}

      const result = await db.functions.invoke('funnel-connection-control', {
        body: {
          action: 'configure',
          funnel_id: funnelId,
          remote_base_url: remoteBaseUrl.trim(),
          remote_funnel_id: remoteFunnelId.trim(),
          write_enabled: writeEnabled,
          credential,
          remote_control: {
            gateway_get_path: getPath.trim(),
            gateway_get_method: 'GET',
            gateway_set_path: setPath.trim(),
            gateway_set_method: 'PATCH',
            gateway_response_path: responsePath.trim(),
            gateway_set_body: bodyTemplate,
            chat_enabled: chatEnabled,
            chat_send_path: chatSendPath.trim(),
            chat_send_method: 'POST',
            chat_message_id_path: chatMessageIdPath.trim(),
            chat_send_body: chatBodyTemplate,
            idempotency_header: 'Idempotency-Key',
            timeout_ms: 15000,
          },
        },
      })

      if (result.error) throw new Error(result.error.message)
      if (!result.data?.ok) throw new Error(result.data?.error || 'Falha ao salvar o controle remoto.')
      setToken('')
      setMessage('Configuração salva no backend. Teste a API antes de usar a troca global.')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao salvar o controle remoto.')
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    if (testing) return
    setTesting(true)
    setError('')
    setMessage('')
    try {
      const result = await db.functions.invoke('funnel-connection-control', {
        body: { action: 'test', funnel_id: funnelId },
      })
      if (result.error) throw new Error(result.error.message)
      if (!result.data?.ok) throw new Error(result.data?.error || 'A API externa não confirmou a gateway atual.')
      const latency = typeof result.data.latency_ms === 'number' ? ' · ' + result.data.latency_ms + 'ms' : ''
      const observed = result.data.observed_remote_gateway_ref || 'não mapeada'
      setMessage('Conexão verificada' + latency + '. Gateway remota observada: ' + observed + '.')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha no teste da API.')
      await load()
    } finally {
      setTesting(false)
    }
  }

  const saveMappings = async () => {
    if (savingMappings) return
    setSavingMappings(true)
    setError('')
    setMessage('')
    try {
      const entries = Object.entries(mappingRefs).filter(([, value]) => value.trim())
      if (!entries.length) throw new Error('Informe pelo menos um identificador remoto de gateway.')

      for (const entry of entries) {
        const gatewayId = entry[0]
        const remoteGatewayRef = entry[1]
        const result = await db.functions.invoke('funnel-connection-control', {
          body: {
            action: 'map_gateway',
            funnel_id: funnelId,
            gateway_id: gatewayId,
            remote_gateway_ref: remoteGatewayRef.trim(),
          },
        })
        if (result.error) throw new Error(result.error.message)
        if (!result.data?.ok) throw new Error(result.data?.error || 'Falha ao salvar um mapeamento.')
      }

      setMessage(entries.length + ' gateway(s) mapeada(s) para este funil.')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao salvar os mapeamentos.')
    } finally {
      setSavingMappings(false)
    }
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
        <div className="flex items-center gap-2 text-xs text-[var(--althea-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Carregando controle remoto...</div>
      </section>
    )
  }

  const meta = statusMeta(connection?.control_status)

  return (
    <section className="space-y-4 rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
      <div className="flex items-start justify-between gap-3 border-b border-white/[.045] pb-3">
        <div className="flex items-start gap-2">
          <Network className="mt-0.5 h-4 w-4 text-[var(--althea-brand)]" />
          <div>
            <h3 className="text-xs font-bold text-white">Controle remoto do funil</h3>
            <p className="mt-1 text-[9px] leading-relaxed text-[var(--althea-muted)]">A Althea lê, altera e consulta novamente a API externa antes de confirmar uma troca.</p>
          </div>
        </div>
        <span className={'flex shrink-0 items-center gap-1.5 text-[8px] font-bold ' + meta.tone}>
          <span className={'h-1.5 w-1.5 rounded-full ' + meta.dot} />{meta.label}
        </span>
      </div>

      {message && <div className="flex items-start gap-2 rounded-xl border border-[rgba(29,184,84,.14)] bg-[rgba(29,184,84,.045)] p-3 text-[10px] text-[#8edca5]"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />{message}</div>}
      {error && <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-950/15 p-3 text-[10px] text-rose-300"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}

      <label className="block space-y-1">
        <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--althea-muted)]">URL base da API</span>
        <div className="relative">
          <Link2 className="absolute left-3 top-3 h-3.5 w-3.5 text-zinc-600" />
          <input value={remoteBaseUrl} onChange={event => setRemoteBaseUrl(event.target.value)} placeholder="https://api.seufunil.com" className="h-10 w-full rounded-xl border border-white/[.045] bg-[var(--althea-bg)] pl-9 pr-3 text-xs font-mono text-white outline-none focus:border-[rgba(29,184,84,.32)]" />
        </div>
      </label>

      <label className="block space-y-1">
        <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--althea-muted)]">ID remoto do funil</span>
        <input value={remoteFunnelId} onChange={event => setRemoteFunnelId(event.target.value)} placeholder="Ex.: scarcity_8472" className="h-10 w-full rounded-xl border border-white/[.045] bg-[var(--althea-bg)] px-3 text-xs font-mono text-white outline-none focus:border-[rgba(29,184,84,.32)]" />
      </label>

      <label className="block space-y-1">
        <span className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-[var(--althea-muted)]">
          <span>Token / chave da API</span>
          {connection?.has_credential && <span className="text-[var(--althea-brand)]">PROTEGIDA NO VAULT</span>}
        </span>
        <div className="relative">
          <KeyRound className="absolute left-3 top-3 h-3.5 w-3.5 text-zinc-600" />
          <input type="password" value={token} onChange={event => setToken(event.target.value)} placeholder={connection?.has_credential ? 'Deixe vazio para manter a credencial atual' : 'Cole a credencial da API'} autoComplete="off" className="h-10 w-full rounded-xl border border-white/[.045] bg-[var(--althea-bg)] pl-9 pr-3 text-xs font-mono text-white outline-none focus:border-[rgba(29,184,84,.32)]" />
        </div>
      </label>

      <details className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)]">
        <summary className="cursor-pointer px-3 py-2.5 text-[9px] font-bold uppercase tracking-wider text-[var(--althea-muted)]">Contrato avançado da API</summary>
        <div className="space-y-3 border-t border-white/[.045] p-3">
          <label className="block space-y-1"><span className="text-[8px] uppercase text-zinc-600">Endpoint para ler gateway</span><input value={getPath} onChange={event => setGetPath(event.target.value)} className="h-9 w-full rounded-lg border border-white/[.045] bg-[var(--althea-bg)] px-3 text-[10px] font-mono text-[#c8d2cc] outline-none" /></label>
          <label className="block space-y-1"><span className="text-[8px] uppercase text-zinc-600">Endpoint para trocar gateway</span><input value={setPath} onChange={event => setSetPath(event.target.value)} className="h-9 w-full rounded-lg border border-white/[.045] bg-[var(--althea-bg)] px-3 text-[10px] font-mono text-[#c8d2cc] outline-none" /></label>
          <label className="block space-y-1"><span className="text-[8px] uppercase text-zinc-600">Caminho da gateway na resposta</span><input value={responsePath} onChange={event => setResponsePath(event.target.value)} placeholder="gateway_id" className="h-9 w-full rounded-lg border border-white/[.045] bg-[var(--althea-bg)] px-3 text-[10px] font-mono text-[#c8d2cc] outline-none" /></label>
          <label className="block space-y-1"><span className="text-[8px] uppercase text-zinc-600">Body da alteração</span><textarea value={setBody} onChange={event => setSetBody(event.target.value)} rows={4} className="w-full rounded-lg border border-white/[.045] bg-[var(--althea-bg)] p-3 text-[9px] font-mono text-[#c8d2cc] outline-none" /></label>
          <div className="border-t border-white/[.045] pt-3">
            <p className="mb-2 text-[8px] font-bold uppercase tracking-wider text-[var(--althea-muted)]">Chat remoto</p>
            <div className="space-y-3">
              <label className="block space-y-1"><span className="text-[8px] uppercase text-zinc-600">Endpoint para responder no chat</span><input value={chatSendPath} onChange={event => setChatSendPath(event.target.value)} className="h-9 w-full rounded-lg border border-white/[.045] bg-[var(--althea-bg)] px-3 text-[10px] font-mono text-[#c8d2cc] outline-none" /></label>
              <label className="block space-y-1"><span className="text-[8px] uppercase text-zinc-600">Caminho do ID da mensagem na resposta</span><input value={chatMessageIdPath} onChange={event => setChatMessageIdPath(event.target.value)} placeholder="message_id" className="h-9 w-full rounded-lg border border-white/[.045] bg-[var(--althea-bg)] px-3 text-[10px] font-mono text-[#c8d2cc] outline-none" /></label>
              <label className="block space-y-1"><span className="text-[8px] uppercase text-zinc-600">Body do envio de chat</span><textarea value={chatSendBody} onChange={event => setChatSendBody(event.target.value)} rows={4} className="w-full rounded-lg border border-white/[.045] bg-[var(--althea-bg)] p-3 text-[9px] font-mono text-[#c8d2cc] outline-none" /></label>
            </div>
          </div>
        </div>
      </details>

      <div className="flex items-center justify-between rounded-xl border border-white/[.045] bg-[var(--althea-bg)] px-3 py-3">
        <div>
          <span className="block text-[10px] font-semibold text-white">Permitir controle remoto</span>
          <span className="text-[8px] text-zinc-600">Autoriza a Althea a trocar a gateway pela API deste funil.</span>
        </div>
        <button type="button" role="switch" aria-checked={writeEnabled} onClick={() => setWriteEnabled(value => !value)} className={'h-5 w-9 rounded-full p-0.5 transition ' + (writeEnabled ? 'bg-[var(--althea-brand)]' : 'bg-zinc-800')}><span className={'block h-4 w-4 rounded-full bg-white shadow transition-transform ' + (writeEnabled ? 'translate-x-4' : '')} /></button>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-white/[.045] bg-[var(--althea-bg)] px-3 py-3">
        <div>
          <span className="block text-[10px] font-semibold text-white">Permitir respostas pelo chat</span>
          <span className="text-[8px] text-zinc-600">Envia a resposta do atendente para a conversa correspondente na API externa do funil.</span>
        </div>
        <button type="button" role="switch" aria-checked={chatEnabled} onClick={() => setChatEnabled(value => !value)} className={'h-5 w-9 rounded-full p-0.5 transition ' + (chatEnabled ? 'bg-[var(--althea-brand)]' : 'bg-zinc-800')}><span className={'block h-4 w-4 rounded-full bg-white shadow transition-transform ' + (chatEnabled ? 'translate-x-4' : '')} /></button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => void save()} disabled={saving} className="flex h-10 items-center justify-center gap-2 rounded-xl bg-[var(--althea-brand)] text-[10px] font-bold text-black disabled:opacity-40">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} SALVAR</button>
        <button type="button" onClick={() => void test()} disabled={testing || !connection?.has_credential} className="flex h-10 items-center justify-center gap-2 rounded-xl border border-white/[.06] bg-[var(--althea-bg)] text-[10px] font-bold text-[#c8d2cc] disabled:opacity-40">{testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />} TESTAR API</button>
      </div>

      {gateways.length > 0 && (
        <div className="space-y-3 border-t border-white/[.045] pt-4">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 text-[var(--althea-brand)]" />
            <div>
              <h4 className="text-[10px] font-bold text-white">Mapeamento das gateways neste funil</h4>
              <p className="mt-1 text-[8px] leading-relaxed text-zinc-600">Informe o identificador que a API externa usa para cada gateway.</p>
            </div>
          </div>

          <div className="space-y-2">
            {gateways.map(gateway => (
              <label key={gateway.id} className="grid gap-2 rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3 sm:grid-cols-[1fr_1fr] sm:items-center">
                <span className="min-w-0">
                  <b className="block truncate text-[10px] text-white">{gateway.display_name || gateway.provider}</b>
                  <small className="text-[8px] font-mono uppercase text-zinc-600">{gateway.provider} · {gateway.environment}</small>
                </span>
                <input value={mappingRefs[gateway.id] || ''} onChange={event => setMappingRefs(current => ({ ...current, [gateway.id]: event.target.value }))} placeholder="ID da gateway no funil externo" className="h-9 w-full rounded-lg border border-white/[.045] bg-black/20 px-3 text-[9px] font-mono text-[#c8d2cc] outline-none focus:border-[rgba(29,184,84,.32)]" />
              </label>
            ))}
          </div>

          <button type="button" onClick={() => void saveMappings()} disabled={savingMappings || !connection} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[rgba(29,184,84,.16)] bg-[var(--althea-brand)]/[0.06] text-[9px] font-bold text-[var(--althea-brand)] disabled:opacity-40">
            {savingMappings ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Network className="h-3.5 w-3.5" />} SALVAR MAPEAMENTOS
          </button>
        </div>
      )}

      {drifts.length > 0 && (
        <div className="space-y-2 border-t border-white/[.045] pt-4">
          <div className="flex items-center justify-between">
            <h4 className="text-[9px] font-bold uppercase tracking-wider text-[var(--althea-muted)]">Drift remoto</h4>
            <span className="text-[8px] font-mono text-zinc-700">{drifts.filter(item => item.status === 'open').length} aberto(s)</span>
          </div>
          {drifts.slice(0, 3).map(item => (
            <div key={item.id} className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[9px] font-bold ${item.status === 'open' ? 'text-amber-400' : 'text-[var(--althea-brand)]'}`}>
                  {item.status === 'open' ? 'DIVERGÊNCIA ABERTA' : 'RESOLVIDO'}
                </span>
                <span className="text-[8px] font-mono text-zinc-700">{item.correlation_id}</span>
              </div>
              <p className="mt-1 text-[9px] text-[var(--althea-muted)]">
                Esperada: {item.expected_gateway_id || '—'} · Observada: {item.observed_gateway_id || item.observed_remote_gateway_ref || 'não mapeada'}
              </p>
              <p className="mt-1 text-[8px] text-zinc-700">Última leitura: {new Date(item.last_seen_at).toLocaleString('pt-BR')}</p>
            </div>
          ))}
        </div>
      )}

      {commands.length > 0 && (
        <div className="space-y-2 border-t border-white/[.045] pt-4">
          <div className="flex items-center justify-between">
            <h4 className="text-[9px] font-bold uppercase tracking-wider text-[var(--althea-muted)]">Histórico de comandos</h4>
            <span className="text-[8px] text-zinc-700">últimos {Math.min(commands.length, 5)}</span>
          </div>
          {commands.map(item => {
            const ok = item.status === 'verified' || item.status === 'preflight_succeeded'
            const bad = item.status === 'failed' || item.status === 'blocked' || item.status === 'cancelled'
            return (
              <div key={item.id} className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[9px] font-bold uppercase ${ok ? 'text-[var(--althea-brand)]' : bad ? 'text-rose-400' : 'text-sky-400'}`}>
                    {item.status.replaceAll('_', ' ')}
                  </span>
                  <span className="text-[8px] font-mono text-zinc-700">{item.correlation_id}</span>
                </div>
                <p className="mt-1 text-[9px] text-[var(--althea-muted)]">
                  {item.previous_gateway_id ? item.previous_gateway_id + ' → ' : ''}{item.target_gateway_id}
                </p>
                {item.last_error_message && <p className="mt-1 text-[8px] text-rose-300">{item.last_error_message}</p>}
                <p className="mt-1 text-[8px] text-zinc-700">
                  {new Date(item.completed_at || item.verified_at || item.created_at).toLocaleString('pt-BR')}
                </p>
              </div>
            )
          })}
        </div>
      )}

      {connection?.last_error && <div className="rounded-xl border border-rose-500/15 bg-rose-950/10 p-3 text-[9px] text-rose-300">{connection.last_error}</div>}
      <button type="button" onClick={() => void load()} className="flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-wider text-zinc-600 hover:text-[#c8d2cc]"><RefreshCw className="h-3 w-3" /> Atualizar estado</button>
    </section>
  )
}
