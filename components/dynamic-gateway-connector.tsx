'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Cpu, Loader2, Pencil, Power, RefreshCw, Unplug, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { getOperationalCredentialFields, getWebhookCredentialFields, type GatewayCredentialField } from '@/components/gateway-provider-fields'

type Provider = {
  id: string
  provider_key: string
  display_name: string
  credential_schema: { fields: GatewayCredentialField[] }
  operational: boolean
  is_custom_or_webhook_only: boolean
  adapter_key?: string | null
  adapter_contract_version?: number | null
}

type Gateway = {
  id: string
  display_name: string | null
  provider: string
  environment: 'sandbox' | 'production'
  status: string
  credential_id: string | null
}

const adapterName = (provider: Provider) =>
  provider.provider_key === 'generic_http' || provider.adapter_key === 'generic_http_json'
    ? 'API REST / HTTP genérica'
    : provider.display_name

const validSchema = (value: unknown): value is { fields: GatewayCredentialField[] } => {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { fields?: unknown }).fields)) return false
  return (value as { fields: unknown[] }).fields.every(item => {
    if (!item || typeof item !== 'object') return false
    const field = item as Record<string, unknown>
    return typeof field.name === 'string' && typeof field.label === 'string' &&
      (field.type === 'text' || field.type === 'password') && typeof field.required === 'boolean'
  })
}

const statusLabel = (status: string) => ({
  active: 'ATIVO', connected: 'CONECTADO', degraded: 'DEGRADADO', error: 'ERRO',
  disabled: 'DESATIVADO', connecting: 'CONECTANDO', inactive: 'INATIVO', disconnected: 'DESCONECTADO',
} as Record<string, string>)[status.toLowerCase()] ?? 'NÃO VALIDADO'

export const DynamicGatewayConnector: React.FC = () => {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [providers, setProviders] = useState<Provider[]>([])
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [providerKey, setProviderKey] = useState('')
  const [name, setName] = useState('')
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('production')
  const [values, setValues] = useState<Record<string, string>>({})
  const [webhookValues, setWebhookValues] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    const { data: auth, error: authError } = await db.auth.getUser()
    if (authError || !auth.user?.id) {
      setLoading(false)
      if (authError) setError(authError.message)
      return
    }

    const [providerResult, gatewayResult] = await Promise.all([
      db.from('gateway_provider_registry')
        .select('id,provider_key,display_name,credential_schema,operational,is_custom_or_webhook_only,adapter_key,adapter_contract_version')
        .eq('is_active', true)
        .order('display_name'),
      db.from('gateways')
        .select('id,display_name,provider,environment,status,credential_id')
        .order('created_at', { ascending: false }),
    ])

    if (providerResult.error) setError(providerResult.error.message)
    else {
      const list = (providerResult.data ?? [])
        .filter(provider => validSchema(provider.credential_schema) && provider.operational && provider.provider_key !== 'custom_rest')
        .sort((a, b) => Number(b.adapter_contract_version ?? 0) - Number(a.adapter_contract_version ?? 0)) as Provider[]
      setProviders(list.filter((provider, index, all) =>
        all.findIndex(item => (item.adapter_key || item.provider_key) === (provider.adapter_key || provider.provider_key)) === index
      ))
    }

    if (gatewayResult.error) setError(current => current ?? gatewayResult.error!.message)
    else setGateways((gatewayResult.data ?? []) as Gateway[])
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const active = providers.find(provider => provider.provider_key === providerKey) ?? null
  const isGenericHttp = active?.provider_key === 'generic_http' || active?.adapter_key === 'generic_http_json'
  const credentialFields = useMemo(
    () => getOperationalCredentialFields(active?.credential_schema.fields ?? [], isGenericHttp),
    [active, isGenericHttp]
  )
  const webhookFields = useMemo(
    () => getWebhookCredentialFields(active?.credential_schema.fields ?? []),
    [active]
  )

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const credential of credentialFields) next[credential.name] = ''
    const nextWebhook: Record<string, string> = {}
    for (const credential of webhookFields) nextWebhook[credential.name] = ''
    setValues(next)
    setWebhookValues(nextWebhook)
  }, [credentialFields, webhookFields])

  const reset = () => {
    setEditing(null)
    setProviderKey('')
    setName('')
    setEnvironment('production')
    setValues({})
    setWebhookValues({})
  }

  const test = async (gatewayId: string) => {
    setTesting(gatewayId)
    setError(null)
    try {
      const { data, error: invokeError } = await db.functions.invoke('gateway-connection-test', { body: { gateway_id: gatewayId } })
      if (invokeError) throw new Error(invokeError.message)
      if (!data?.ok) throw new Error(data?.error || 'Falha ao validar a conexão.')
      setMessage(`Gateway validado${typeof data.latency_ms === 'number' ? ` · ${data.latency_ms}ms` : ''}.`)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível validar o gateway.')
      await load()
    } finally {
      setTesting(null)
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!active || saving) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      if (!name.trim()) throw new Error('Dê um nome para esta conexão de gateway.')
      if (!editing) {
        for (const credential of credentialFields) {
          if (credential.required && !values[credential.name]?.trim()) throw new Error(`Preencha: ${credential.label}.`)
        }
        for (const credential of webhookFields) {
          if (credential.required && !webhookValues[credential.name]?.trim()) throw new Error(`Preencha: ${credential.label}.`)
        }
      }
      const credentials = { ...values, ...webhookValues }

      const rpc = editing
        ? await db.rpc('update_dynamic_gateway', {
            p_gateway_id: editing,
            p_display_name: name.trim(),
            p_environment: environment,
            p_credentials: Object.values(credentials).some(value => value.trim()) ? credentials : {},
          })
        : await db.rpc('register_dynamic_gateway', {
            p_provider_key: active.provider_key,
            p_display_name: name.trim(),
            p_environment: environment,
            p_credentials: credentials,
            p_metadata: { source: 'althea_gateway_connection_v9' },
          })

      if (rpc.error) throw new Error(rpc.error.message)
      const gatewayId = typeof rpc.data?.gateway_id === 'string' ? rpc.data.gateway_id : editing
      setMessage(editing ? 'Gateway atualizado. Validando a configuração.' : 'Gateway cadastrado. Validando a conexão.')
      await load()
      if (gatewayId) await test(gatewayId)
      reset()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao salvar o gateway.')
    } finally {
      setSaving(false)
    }
  }

  const edit = (gateway: Gateway) => {
    setEditing(gateway.id)
    setProviderKey(gateway.provider)
    setName(gateway.display_name ?? '')
    setEnvironment(gateway.environment)
    setError(null)
    setMessage(null)
  }

  const toggle = async (gateway: Gateway) => {
    if (!gateway.credential_id || testing) return
    const enabled = !['disabled', 'inactive'].includes(gateway.status.toLowerCase())
    const { error: credentialError } = await db.rpc('set_gateway_credential_status', {
      p_credential_id: gateway.credential_id,
      p_is_active: !enabled,
    })
    if (credentialError) { setError(credentialError.message); return }
    if (enabled) {
      setMessage('Gateway desativado.')
      await load()
      return
    }
    setMessage('Gateway reativado. Validando a conexão novamente.')
    await load()
    await test(gateway.id)
  }

  const disconnect = async (gateway: Gateway) => {
    if (testing) return
    const { error: disconnectError } = await db.rpc('disconnect_dynamic_gateway', { p_gateway_id: gateway.id })
    if (disconnectError) { setError(disconnectError.message); return }
    setMessage('Gateway desconectado. O histórico financeiro foi preservado.')
    await load()
  }

  const renderField = (credential: GatewayCredentialField, target: 'credential' | 'webhook' = 'credential') => {
    const source = target === 'webhook' ? webhookValues : values
    const setSource = target === 'webhook' ? setWebhookValues : setValues
    return (
      <label key={credential.name} className="block space-y-1.5">
        <span className="text-[10px] font-mono uppercase text-neutral-400">
          {credential.label}{credential.required ? ' *' : ''}
        </span>
        <input
          type={credential.type}
          value={source[credential.name] ?? ''}
          onChange={event => setSource(current => ({ ...current, [credential.name]: event.target.value }))}
          autoComplete="off"
          className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm text-white outline-none focus:border-emerald-700"
        />
      </label>
    )
  }

  return (
    <section className="w-full rounded-xl border border-neutral-800 bg-neutral-950 p-5 md:p-6 space-y-5">
      <header className="flex items-center justify-between gap-3 border-b border-neutral-900 pb-4">
        <div className="flex items-center gap-3">
          <Cpu className="h-4 w-4 text-[#1DB854]" />
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider font-mono text-white">Central de Gateways</h3>
            <p className="mt-1 text-[11px] text-neutral-500">Conecte, teste, edite e desative gateways sem alterar código.</p>
          </div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-lg border border-neutral-800 p-2 text-neutral-400">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {message && <div className="flex items-center gap-2 rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3 text-xs text-emerald-400"><CheckCircle2 className="h-4 w-4" />{message}</div>}
      {error && <div className="flex items-center gap-2 rounded-lg border border-rose-900/50 bg-rose-950/20 p-3 text-xs text-rose-400"><AlertCircle className="h-4 w-4" />{error}</div>}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">Gateways conectados</h4>
          <span className="text-[9px] font-mono text-neutral-600">{gateways.length} conexão(ões)</span>
        </div>
        {gateways.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-800 p-4 text-xs text-neutral-500">Nenhum gateway cadastrado. Adicione uma conexão abaixo.</div>
        ) : (
          <div className="space-y-2">
            {gateways.map(gateway => (
              <div key={gateway.id} className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 p-3">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-white">{gateway.display_name || 'Gateway sem nome'}</div>
                  <div className="mt-1 text-[9px] font-mono uppercase text-neutral-500">{gateway.provider} · {gateway.environment} · {statusLabel(gateway.status)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${['active', 'connected', 'degraded'].includes(gateway.status.toLowerCase()) ? 'bg-emerald-500' : 'bg-neutral-600'}`} />
                  <button type="button" onClick={() => edit(gateway)} className="rounded-md border border-neutral-700 p-2 text-neutral-300"><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => void test(gateway.id)} disabled={testing !== null} className="rounded-md border border-neutral-700 px-2.5 py-2 text-[9px] font-bold font-mono text-white">{testing === gateway.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'TESTAR'}</button>
                  <button type="button" onClick={() => void toggle(gateway)} disabled={testing !== null || !gateway.credential_id} className="rounded-md border border-neutral-700 p-2 text-neutral-300"><Power className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => void disconnect(gateway)} disabled={testing !== null} className="rounded-md border border-neutral-700 p-2 text-neutral-300"><Unplug className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!loading && (
        <form onSubmit={submit} className="space-y-5 border-t border-neutral-900 pt-5">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-[10px] font-medium uppercase tracking-wide text-neutral-200">{editing ? 'Editar conexão' : 'Nova conexão de gateway'}</h4>
              <p className="mt-1 text-[10px] text-neutral-600">Providers nativos pedem só credenciais. A opção HTTP genérica libera configuração avançada de API.</p>
            </div>
            {editing && <button type="button" onClick={reset} className="text-neutral-500"><X className="h-4 w-4" /></button>}
          </div>

          <label className="block space-y-1.5">
            <span className="text-[10px] font-mono uppercase text-neutral-400">Nome do gateway</span>
            <input value={name} onChange={event => setName(event.target.value)} placeholder="Ex.: Minha conexão de pagamentos" className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm text-white outline-none" />
          </label>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-neutral-400">Provedor / Adapter</span>
              <select value={providerKey} onChange={event => setProviderKey(event.target.value)} disabled={!!editing} className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm text-white outline-none">
                <option value="">Selecione o provedor...</option>
                {providers.map(provider => <option key={provider.id} value={provider.provider_key}>{adapterName(provider)}</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-neutral-400">Ambiente</span>
              <select value={environment} onChange={event => setEnvironment(event.target.value as 'sandbox' | 'production')} className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm text-white outline-none">
                <option value="production">Produção</option>
                <option value="sandbox">Sandbox / Testes</option>
              </select>
            </label>
          </div>

          {active && credentialFields.length > 0 && (
            <div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
              <div>
                <h5 className="text-xs font-semibold uppercase tracking-wide text-white">{isGenericHttp ? 'Credenciais e configuração avançada da API' : 'Credenciais da conexão'}</h5>
                <p className="mt-1 text-[10px] text-neutral-500">{isGenericHttp ? 'A URL base e os endpoints ficam configuráveis porque este provider representa uma API ainda não nativa.' : 'O transporte técnico é herdado do adapter canônico do provider.'}</p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{credentialFields.map(credential => renderField(credential))}</div>
            </div>
          )}

          {active && webhookFields.length > 0 && (
            <div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
              <div>
                <h5 className="text-xs font-semibold uppercase tracking-wide text-white">Webhook / assinatura</h5>
                <p className="mt-1 text-[10px] text-neutral-500">Segredo usado para validar eventos assinados do provedor.</p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{webhookFields.map(credential => renderField(credential, 'webhook'))}</div>
            </div>
          )}

          {active && credentialFields.length === 0 && webhookFields.length === 0 && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-xs text-neutral-500">Este provider não exige credenciais manuais. A configuração técnica é resolvida pelo adapter.</div>
          )}

          <button type="submit" disabled={!active || saving} className="w-full rounded-lg border border-emerald-800 bg-emerald-950/30 p-3 text-xs font-bold uppercase tracking-wider text-emerald-400 disabled:opacity-40">
            {saving ? 'SALVANDO...' : editing ? 'SALVAR ALTERAÇÕES' : 'CADASTRAR GATEWAY'}
          </button>
        </form>
      )}
    </section>
  )
}
