'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, KeyRound, Link2, Loader2, Network, RefreshCw, Save, ShieldCheck } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type ConnectionState = {
  id: string
  funnel_id: string
  adapter_key: string | null
  remote_base_url: string | null
  remote_funnel_id: string | null
  capabilities: string[] | null
  write_enabled: boolean | null
  desired_gateway_id: string | null
  observed_gateway_id: string | null
  last_verified_at: string | null
  last_command_at: string | null
  control_status: string | null
  health_status: string | null
  last_error: string | null
  has_credential: boolean
  remote_control: Record<string, unknown>
}

type GatewayMapping = {
  id: string
  gateway_id: string
  remote_gateway_ref: string
  status: string
}

type GatewayOption = {
  id: string
  display_name: string | null
  provider: string | null
  environment: string | null
  status: string | null
}

type StatePayload = {
  ok?: boolean
  connection?: ConnectionState | null
  mappings?: GatewayMapping[]
  gateways?: GatewayOption[]
  error?: string
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function controlTone(status: string | null | undefined) {
  const value = String(status || '').toLowerCase()
  if (value === 'ready') return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
  if (value === 'degraded' || value === 'syncing') return 'border-amber-400/20 bg-amber-400/10 text-amber-200'
  if (value === 'error') return 'border-rose-400/20 bg-rose-400/10 text-rose-200'
  return 'border-white/10 bg-white/[0.04] text-zinc-400'
}

export function FunnelRemoteControl({ funnelId }: { funnelId: string }) {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [connection, setConnection] = useState<ConnectionState | null>(null)
  const [mappings, setMappings] = useState<GatewayMapping[]>([])
  const [gateways, setGateways] = useState<GatewayOption[]>([])
  const [mappingInputs, setMappingInputs] = useState<Record<string, string>>({})
  const [remoteBaseUrl, setRemoteBaseUrl] = useState('')
  const [remoteFunnelId, setRemoteFunnelId] = useState('')
  const [gatewayGetPath, setGatewayGetPath] = useState('/funnels/{{remote_funnel_id}}/gateway')
  const [gatewayGetMethod, setGatewayGetMethod] = useState('GET')
  const [gatewaySetPath, setGatewaySetPath] = useState('/funnels/{{remote_funnel_id}}/gateway')
  const [gatewaySetMethod, setGatewaySetMethod] = useState('PATCH')
  const [gatewayResponsePath, setGatewayResponsePath] = useState('gateway_id')
  const [token, setToken] = useState('')
  const [authHeader, setAuthHeader] = useState('Authorization')
  const [authPrefix, setAuthPrefix] = useState('Bearer')
  const [writeEnabled, setWriteEnabled] = useState(false)
  const [busy, setBusy] = useState<'load' | 'save' | 'map' | 'test' | 'write' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [testResult, setTestResult] = useState<{ observed: string | null; mapped: string | null; latency: number | null } | null>(null)

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data: sessionData, error: sessionError } = await db.auth.getSession()
    if (sessionError || !sessionData.session?.access_token) throw new Error('Sessão expirada. Faça login novamente.')
    const { data, error: invokeError } = await db.functions.invoke('funnel-connection-control', {
      body,
      headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
    })
    if (invokeError) throw new Error(invokeError.message || 'Falha na operação de controle remoto.')
    const payload = record(data)
    if (payload.ok !== true) throw new Error(stringValue(payload.error, 'Operação remota não concluída.'))
    return payload
  }, [db])

  const load = useCallback(async () => {
    if (!funnelId) return
    setBusy('load')
    setError('')
    try {
      const payload = await invoke({ action: 'state', funnel_id: funnelId }) as StatePayload
      const nextConnection = payload.connection ?? null
      const nextMappings = Array.isArray(payload.mappings) ? payload.mappings : []
      const nextGateways = Array.isArray(payload.gateways) ? payload.gateways : []
      setConnection(nextConnection)
      setMappings(nextMappings)
      setGateways(nextGateways)
      setMappingInputs(Object.fromEntries(nextGateways.map((gateway) => [
        gateway.id,
        nextMappings.find((mapping) => mapping.gateway_id === gateway.id)?.remote_gateway_ref ?? '',
      ])))

      if (nextConnection) {
        const remoteControl = record(nextConnection.remote_control)
        setRemoteBaseUrl(nextConnection.remote_base_url ?? '')
        setRemoteFunnelId(nextConnection.remote_funnel_id ?? '')
        setGatewayGetPath(stringValue(remoteControl.gateway_get_path, '/funnels/{{remote_funnel_id}}/gateway'))
        setGatewayGetMethod(stringValue(remoteControl.gateway_get_method, 'GET'))
        setGatewaySetPath(stringValue(remoteControl.gateway_set_path, '/funnels/{{remote_funnel_id}}/gateway'))
        setGatewaySetMethod(stringValue(remoteControl.gateway_set_method, 'PATCH'))
        setGatewayResponsePath(stringValue(remoteControl.gateway_response_path, 'gateway_id'))
        setWriteEnabled(nextConnection.write_enabled === true)
      } else {
        setRemoteBaseUrl('')
        setRemoteFunnelId('')
        setGatewayGetPath('/funnels/{{remote_funnel_id}}/gateway')
        setGatewayGetMethod('GET')
        setGatewaySetPath('/funnels/{{remote_funnel_id}}/gateway')
        setGatewaySetMethod('PATCH')
        setGatewayResponsePath('gateway_id')
        setWriteEnabled(false)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o controle remoto do funil.')
    } finally {
      setBusy(null)
    }
  }, [funnelId, invoke])

  useEffect(() => { void load() }, [load])

  const save = useCallback(async () => {
    if (!remoteBaseUrl.trim() || !remoteFunnelId.trim()) {
      setError('Informe a URL base da API remota e o ID remoto do funil.')
      return
    }
    if (!connection?.has_credential && !token.trim()) {
      setError('Informe a credencial da API remota para configurar o conector pela primeira vez.')
      return
    }
    setBusy('save')
    setError('')
    setNotice('')
    try {
      await invoke({
        action: 'configure',
        funnel_id: funnelId,
        remote_base_url: remoteBaseUrl.trim(),
        remote_funnel_id: remoteFunnelId.trim(),
        write_enabled: writeEnabled,
        credential: token.trim() ? {
          token: token.trim(),
          auth_header: authHeader.trim() || 'Authorization',
          auth_prefix: authPrefix,
        } : {},
        remote_control: {
          gateway_get_path: gatewayGetPath.trim() || '/funnels/{{remote_funnel_id}}/gateway',
          gateway_get_method: gatewayGetMethod,
          gateway_set_path: gatewaySetPath.trim() || gatewayGetPath.trim() || '/funnels/{{remote_funnel_id}}/gateway',
          gateway_set_method: gatewaySetMethod,
          gateway_response_path: gatewayResponsePath.trim() || 'gateway_id',
          gateway_set_body: { gateway_id: '{{target_remote_gateway_ref}}' },
          idempotency_header: 'Idempotency-Key',
          timeout_ms: 15000,
        },
      })
      setToken('')
      setNotice('Conector remoto salvo. A credencial está protegida no Vault e não será exibida novamente.')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o conector remoto.')
    } finally {
      setBusy(null)
    }
  }, [authHeader, authPrefix, connection?.has_credential, funnelId, gatewayGetMethod, gatewayGetPath, gatewayResponsePath, gatewaySetMethod, gatewaySetPath, invoke, load, remoteBaseUrl, remoteFunnelId, token, writeEnabled])

  const saveMappings = useCallback(async () => {
    if (!connection) return
    const entries = gateways
      .map((gateway) => [gateway.id, (mappingInputs[gateway.id] || '').trim()] as const)
      .filter(([, remoteRef]) => Boolean(remoteRef))
    if (!entries.length) {
      setError('Informe ao menos uma referência remota de gateway.')
      return
    }

    setBusy('map')
    setError('')
    setNotice('')
    try {
      for (const [gatewayId, remoteRef] of entries) {
        const existing = mappings.find((mapping) => mapping.gateway_id === gatewayId)
        if (existing?.remote_gateway_ref === remoteRef && existing.status === 'active') continue
        await invoke({
          action: 'map_gateway',
          funnel_id: funnelId,
          gateway_id: gatewayId,
          remote_gateway_ref: remoteRef,
        })
      }
      setNotice('Mapeamentos salvos. O preflight global já pode validar as gateways mapeadas neste funil.')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar os mapeamentos.')
    } finally {
      setBusy(null)
    }
  }, [connection, funnelId, gateways, invoke, load, mappingInputs, mappings])

  const test = useCallback(async () => {
    if (!connection) {
      setError('Configure o conector remoto antes de testar.')
      return
    }
    setBusy('test')
    setError('')
    setNotice('')
    try {
      const result = await invoke({ action: 'test', funnel_id: funnelId })
      const latency = Number(result.latency_ms)
      setTestResult({
        observed: typeof result.observed_remote_gateway_ref === 'string' ? result.observed_remote_gateway_ref : null,
        mapped: typeof result.mapped_gateway_id === 'string' ? result.mapped_gateway_id : null,
        latency: Number.isFinite(latency) ? latency : null,
      })
      setNotice('Leitura remota confirmada. O estado de controle foi atualizado pelo backend.')
      await load()
    } catch (cause) {
      setTestResult(null)
      setError(cause instanceof Error ? cause.message : 'O teste remoto falhou.')
    } finally {
      setBusy(null)
    }
  }, [connection, funnelId, invoke, load])

  const toggleWrite = useCallback(async () => {
    if (!connection) return
    const next = !connection.write_enabled
    setBusy('write')
    setError('')
    setNotice('')
    try {
      await invoke({ action: 'set_write_enabled', funnel_id: funnelId, write_enabled: next })
      setNotice(next ? 'Escrita remota habilitada. Execute o teste para levar o controle ao estado READY.' : 'Escrita remota bloqueada. O funil voltou ao modo somente leitura.')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível alterar a permissão de escrita.')
    } finally {
      setBusy(null)
    }
  }, [connection, funnelId, invoke, load])

  const capabilities = connection?.capabilities ?? []
  const ready = connection?.control_status === 'ready'
  const mappedCount = mappings.filter((mapping) => mapping.status === 'active').length

  return (
    <section className="space-y-4 rounded-2xl border border-white/[0.06] bg-[#0c0c0e] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-emerald-500/15 bg-emerald-500/[0.06] text-emerald-400"><Network className="h-4 w-4" /></span>
          <div>
            <h3 className="text-xs font-bold text-zinc-200">Controle remoto do funil</h3>
            <p className="mt-1 max-w-3xl text-[10px] leading-5 text-zinc-500">Prepara este funil para a orquestração global. A Althea lê e altera a gateway na API remota, verifica o resultado e só então sincroniza o binding local.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {connection && <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase ${controlTone(connection.control_status)}`}>{connection.control_status || 'não configurado'}</span>}
          <button type="button" onClick={() => void load()} disabled={busy !== null} className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.06] text-zinc-500 hover:text-white disabled:opacity-40" aria-label="Atualizar controle remoto"><RefreshCw className={`h-3.5 w-3.5 ${busy === 'load' ? 'animate-spin' : ''}`} /></button>
        </div>
      </div>

      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] p-3 text-[10px] leading-5 text-rose-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.05] p-3 text-[10px] leading-5 text-emerald-200">{notice}</div>}

      <div className="grid gap-3 lg:grid-cols-2">
        <label className="space-y-1.5"><span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">URL base da API remota *</span><div className="relative"><Link2 className="absolute left-3 top-3.5 h-3.5 w-3.5 text-zinc-600" /><input type="url" value={remoteBaseUrl} onChange={(event) => setRemoteBaseUrl(event.target.value)} placeholder="https://api.seufunil.com" className="h-11 w-full rounded-xl border border-white/[0.06] bg-[#121214] pl-9 pr-3 text-xs text-zinc-200 outline-none focus:border-emerald-500/40" /></div></label>
        <label className="space-y-1.5"><span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">ID remoto do funil *</span><input value={remoteFunnelId} onChange={(event) => setRemoteFunnelId(event.target.value)} placeholder="Ex.: funnel_123" className="h-11 w-full rounded-xl border border-white/[0.06] bg-[#121214] px-3 text-xs text-zinc-200 outline-none focus:border-emerald-500/40" /></label>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-white/[0.05] bg-[#101012] p-3">
          <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Leitura da gateway atual</span>
          <div className="grid grid-cols-[96px_1fr] gap-2"><select value={gatewayGetMethod} onChange={(event) => setGatewayGetMethod(event.target.value)} className="h-10 rounded-lg border border-white/[0.06] bg-[#151517] px-2 text-[10px] text-white"><option>GET</option><option>POST</option></select><input value={gatewayGetPath} onChange={(event) => setGatewayGetPath(event.target.value)} className="h-10 min-w-0 rounded-lg border border-white/[0.06] bg-[#151517] px-3 font-mono text-[10px] text-zinc-300" /></div>
          <label className="block space-y-1"><span className="text-[8px] uppercase text-zinc-600">Caminho do ID na resposta</span><input value={gatewayResponsePath} onChange={(event) => setGatewayResponsePath(event.target.value)} placeholder="gateway_id" className="h-10 w-full rounded-lg border border-white/[0.06] bg-[#151517] px-3 font-mono text-[10px] text-zinc-300" /></label>
        </div>
        <div className="space-y-3 rounded-xl border border-white/[0.05] bg-[#101012] p-3">
          <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Troca remota</span>
          <div className="grid grid-cols-[96px_1fr] gap-2"><select value={gatewaySetMethod} onChange={(event) => setGatewaySetMethod(event.target.value)} className="h-10 rounded-lg border border-white/[0.06] bg-[#151517] px-2 text-[10px] text-white"><option>PATCH</option><option>PUT</option><option>POST</option></select><input value={gatewaySetPath} onChange={(event) => setGatewaySetPath(event.target.value)} className="h-10 min-w-0 rounded-lg border border-white/[0.06] bg-[#151517] px-3 font-mono text-[10px] text-zinc-300" /></div>
          <p className="text-[9px] leading-4 text-zinc-600">Body enviado: <code>{'{"gateway_id":"{{target_remote_gateway_ref}}"}'}</code></p>
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.05] bg-[#101012] p-3">
        <div className="mb-3 flex items-center gap-2"><KeyRound className="h-3.5 w-3.5 text-emerald-400" /><span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Autenticação da API remota</span>{connection?.has_credential && <span className="ml-auto text-[8px] font-bold text-emerald-400">CREDENCIAL NO VAULT</span>}</div>
        <div className="grid gap-2 md:grid-cols-[1fr_160px_120px]">
          <input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="new-password" placeholder={connection?.has_credential ? 'Deixe em branco para manter a credencial atual' : 'Token / API key *'} className="h-10 min-w-0 rounded-lg border border-white/[0.06] bg-[#151517] px-3 text-[10px] text-zinc-300" />
          <input value={authHeader} onChange={(event) => setAuthHeader(event.target.value)} placeholder="Authorization" className="h-10 min-w-0 rounded-lg border border-white/[0.06] bg-[#151517] px-3 font-mono text-[10px] text-zinc-300" />
          <input value={authPrefix} onChange={(event) => setAuthPrefix(event.target.value)} placeholder="Bearer" className="h-10 min-w-0 rounded-lg border border-white/[0.06] bg-[#151517] px-3 font-mono text-[10px] text-zinc-300" />
        </div>
        <p className="mt-2 text-[9px] leading-4 text-zinc-600">Para APIs com <code>X-API-Key</code>, use esse nome em Header e deixe Prefixo vazio.</p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-white/[0.05] bg-[#101012] p-3 sm:flex-row sm:items-center sm:justify-between">
        <div><span className="block text-[10px] font-semibold text-zinc-200">Permitir troca remota de gateway</span><span className="mt-1 block text-[9px] text-zinc-600">Necessário para a execução global. O preflight continuará bloqueando qualquer funil não validado.</span></div>
        <button type="button" role="switch" aria-checked={writeEnabled} onClick={() => setWriteEnabled((value) => !value)} className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition ${writeEnabled ? 'bg-emerald-500' : 'bg-zinc-800'}`}><span className={`block h-5 w-5 rounded-full bg-white transition-transform ${writeEnabled ? 'translate-x-5' : 'translate-x-0'}`} /></button>
      </div>

      <button type="button" onClick={() => void save()} disabled={busy !== null} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-bold text-black disabled:opacity-40">{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar controle remoto</button>

      {connection && (
        <>
          <div className="space-y-3 rounded-xl border border-white/[0.05] bg-[#101012] p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Mapeamento de gateways</span><p className="mt-1 text-[9px] text-zinc-600">{mappedCount}/{gateways.length} gateways com referência remota.</p></div><button type="button" onClick={() => void saveMappings()} disabled={busy !== null || gateways.length === 0} className="min-h-10 rounded-lg border border-white/[0.07] px-3 text-[10px] font-bold text-zinc-300 disabled:opacity-40">{busy === 'map' ? 'Salvando...' : 'Salvar mapeamentos'}</button></div>
            {gateways.length === 0 ? <p className="text-[10px] text-zinc-600">Nenhuma gateway cadastrada nesta organização.</p> : <div className="space-y-2">{gateways.map((gateway) => <div key={gateway.id} className="grid gap-2 rounded-lg border border-white/[0.04] bg-[#151517] p-2 sm:grid-cols-[minmax(180px,1fr)_minmax(220px,1.2fr)] sm:items-center"><div className="min-w-0"><b className="block truncate text-[10px] text-zinc-200">{gateway.display_name || gateway.provider || gateway.id}</b><span className="text-[8px] uppercase text-zinc-600">{gateway.provider || 'provider'} · {gateway.environment || 'default'} · {gateway.status || 'unknown'}</span></div><input value={mappingInputs[gateway.id] || ''} onChange={(event) => setMappingInputs((current) => ({ ...current, [gateway.id]: event.target.value }))} placeholder="ID desta gateway dentro do funil remoto" className="h-10 min-w-0 rounded-lg border border-white/[0.06] bg-[#0f0f11] px-3 font-mono text-[10px] text-zinc-300" /></div>)}</div>}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => void toggleWrite()} disabled={busy !== null} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[0.07] px-4 text-[10px] font-bold text-zinc-300 disabled:opacity-40"><ShieldCheck className="h-4 w-4" />{busy === 'write' ? 'Atualizando...' : connection.write_enabled ? 'Bloquear escrita remota' : 'Habilitar escrita remota'}</button>
            <button type="button" onClick={() => void test()} disabled={busy !== null} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] px-4 text-[10px] font-bold text-emerald-300 disabled:opacity-40">{busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Testar leitura remota</button>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Status label="Escrita" value={connection.write_enabled ? 'Habilitada' : 'Bloqueada'} ok={connection.write_enabled === true} />
            <Status label="Gateway:read" value={capabilities.includes('gateway:read') ? 'Ativo' : 'Ausente'} ok={capabilities.includes('gateway:read')} />
            <Status label="Gateway:write" value={capabilities.includes('gateway:write') ? 'Ativo' : 'Ausente'} ok={capabilities.includes('gateway:write')} />
            <Status label="Controle" value={ready ? 'Ready' : connection.control_status || '—'} ok={ready} />
          </div>

          {testResult && <div className="rounded-xl border border-white/[0.05] bg-[#101012] p-3 text-[10px] text-zinc-400"><span className="font-semibold text-zinc-200">Último teste:</span> gateway remoto <code>{testResult.observed || 'não identificado'}</code>{testResult.mapped ? <> · mapeado para <code>{testResult.mapped}</code></> : ' · sem mapeamento local'}{testResult.latency !== null ? ` · ${testResult.latency} ms` : ''}</div>}
          {connection.last_error && <div className="rounded-xl border border-rose-500/15 bg-rose-500/[0.04] p-3 text-[10px] leading-5 text-rose-200">{connection.last_error}</div>}
        </>
      )}
    </section>
  )
}

function Status({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return <div className="rounded-xl border border-white/[0.05] bg-[#101012] p-3"><span className="text-[8px] uppercase tracking-wider text-zinc-600">{label}</span><strong className={`mt-1 block text-[10px] ${ok ? 'text-emerald-300' : 'text-zinc-400'}`}>{value}</strong></div>
}
