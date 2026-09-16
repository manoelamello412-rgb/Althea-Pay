'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Cpu, Loader2, Pencil, Plus, Power, RefreshCw, Unplug, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type SchemaField = { name: string; label: string; type: 'text' | 'password'; required: boolean }
type ProviderRegistry = { id: string; provider_key: string; display_name: string; credential_schema: { fields: SchemaField[] }; operational: boolean; is_custom_or_webhook_only: boolean; adapter_key?: string | null; adapter_contract_version?: number | null }
type GatewayConnection = { id: string; display_name: string | null; provider: string; environment: 'sandbox' | 'production'; status: string; credential_id: string | null }

const friendlyAdapterName = (provider: ProviderRegistry) => {
  const key = provider.provider_key.toLowerCase()
  if (key === 'custom_rest' || key === 'generic_http' || provider.adapter_key === 'generic_http_json') return 'API REST / HTTP genérica'
  if (provider.is_custom_or_webhook_only) return 'API personalizada / Webhook'
  return provider.display_name
}

const validSchema = (value: unknown): value is { fields: SchemaField[] } => {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { fields?: unknown }).fields)) return false
  return (value as { fields: unknown[] }).fields.every(field => {
    if (!field || typeof field !== 'object') return false
    const f = field as Record<string, unknown>
    return typeof f.name === 'string' && typeof f.label === 'string' && (f.type === 'text' || f.type === 'password') && typeof f.required === 'boolean'
  })
}

const statusLabel = (value: string) => {
  switch (value.trim().toLowerCase()) {
    case 'connected': return 'CONECTADO'
    case 'degraded': return 'DEGRADADO'
    case 'error': return 'ERRO'
    case 'disabled': return 'DESATIVADO'
    case 'connecting': return 'CONECTANDO'
    default: return 'NÃO VALIDADO'
  }
}

export const DynamicGatewayConnector: React.FC = () => {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [providers, setProviders] = useState<ProviderRegistry[]>([])
  const [connections, setConnections] = useState<GatewayConnection[]>([])
  const [selectedProviderKey, setSelectedProviderKey] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('production')
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [editingGatewayId, setEditingGatewayId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    const { data: auth, error: authError } = await db.auth.getUser()
    const userId = auth.user?.id
    if (authError || !userId) {
      setProviders([]); setConnections([]); setLoading(false)
      if (authError) setError(authError.message)
      return
    }
    const [registry, gatewayRows] = await Promise.all([
      db.from('gateway_provider_registry').select('id,provider_key,display_name,credential_schema,operational,is_custom_or_webhook_only,adapter_key,adapter_contract_version').eq('is_active', true).order('display_name', { ascending: true }),
      // Tenant isolation is enforced by gateways RLS through organization_id.
      db.from('gateways').select('id,display_name,provider,environment,status,credential_id').order('created_at', { ascending: false })
    ])
    if (registry.error) setError(registry.error.message)
    else {
      const available = (registry.data ?? [])
        .filter(p => validSchema(p.credential_schema) && p.operational)
        // custom_rest is a legacy compatibility registration of the same generic_http_json adapter.
        .filter(p => p.provider_key !== 'custom_rest')
        .sort((a, b) => Number(b.adapter_contract_version ?? 0) - Number(a.adapter_contract_version ?? 0)) as ProviderRegistry[]
      const unique = available.filter((provider, index, all) => all.findIndex(candidate => {
        const candidateKey = candidate.adapter_key || candidate.provider_key
        const providerKey = provider.adapter_key || provider.provider_key
        return candidateKey === providerKey
      }) === index)
      setProviders(unique)
    }
    if (gatewayRows.error) setError(e => e ?? gatewayRows.error.message)
    else setConnections((gatewayRows.data ?? []) as GatewayConnection[])
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const activeProvider = providers.find(p => p.provider_key === selectedProviderKey) ?? null
  useEffect(() => {
    const next: Record<string, string> = {}
    for (const field of activeProvider?.credential_schema.fields ?? []) next[field.name] = ''
    setFormValues(next)
  }, [activeProvider])

  const resetForm = () => {
    setEditingGatewayId(null)
    setSelectedProviderKey('')
    setDisplayName('')
    setEnvironment('production')
    setFormValues({})
  }

  const testConnection = async (gatewayId: string) => {
    setTesting(gatewayId); setError(null); setMessage(null)
    try {
      const { data, error: invokeError } = await db.functions.invoke('gateway-connection-test', { body: { gateway_id: gatewayId } })
      if (invokeError) throw new Error(invokeError.message)
      if (!data?.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Falha ao validar a conexão.')
      setMessage(`Gateway validado com sucesso${typeof data.latency_ms === 'number' ? ` · ${data.latency_ms}ms` : ''}.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível validar o gateway.')
      await load()
    } finally { setTesting(null) }
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!activeProvider || saving) return
    setSaving(true); setError(null); setMessage(null)
    try {
      if (!displayName.trim()) throw new Error('Dê um nome para esta conexão de gateway.')
      if (!editingGatewayId) {
        for (const field of activeProvider.credential_schema.fields) {
          if (field.required && !formValues[field.name]?.trim()) throw new Error(`Preencha: ${field.label}.`)
        }
        const { data, error: rpcError } = await db.rpc('register_dynamic_gateway', {
          p_provider_key: activeProvider.provider_key,
          p_display_name: displayName.trim(),
          p_environment: environment,
          p_credentials: formValues,
          p_metadata: { source: 'althea_gateway_connection_v4' }
        })
        if (rpcError) throw new Error(rpcError.message)
        const gatewayId = typeof data?.gateway_id === 'string' ? data.gateway_id : null
        if (!gatewayId) throw new Error('A conexão foi criada sem identificador operacional.')
        setMessage('Gateway cadastrado. A conexão será validada agora.')
        await load()
        if (data?.operational === true) await testConnection(gatewayId)
      } else {
        const { data, error: rpcError } = await db.rpc('update_dynamic_gateway', {
          p_gateway_id: editingGatewayId,
          p_display_name: displayName.trim(),
          p_environment: environment,
          p_credentials: Object.values(formValues).some(v => v.trim()) ? formValues : {}
        })
        if (rpcError) throw new Error(rpcError.message)
        setMessage(data?.credentials_updated ? 'Gateway atualizado. Validando a nova configuração.' : 'Gateway atualizado.')
        const id = editingGatewayId
        await load()
        if (data?.credentials_updated) await testConnection(id)
      }
      resetForm()
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao salvar o gateway.') }
    finally { setSaving(false) }
  }

  const edit = (gateway: GatewayConnection) => {
    setEditingGatewayId(gateway.id)
    setSelectedProviderKey(gateway.provider)
    setDisplayName(gateway.display_name ?? '')
    setEnvironment(gateway.environment)
    setMessage(null); setError(null)
  }

  const toggle = async (gateway: GatewayConnection) => {
    if (!gateway.credential_id || testing) return
    setError(null)
    const enabled = !['disabled', 'inactive'].includes(gateway.status.toLowerCase())
    const { error: credentialError } = await db.rpc('set_gateway_credential_status', { p_credential_id: gateway.credential_id, p_is_active: !enabled })
    if (credentialError) { setError(credentialError.message); return }
    const { error: updateError } = await db.from('gateways').update({ status: enabled ? 'disabled' : 'inactive' }).eq('id', gateway.id)
    if (updateError) { setError(updateError.message); return }
    setMessage(enabled ? 'Gateway desativado. Histórico financeiro preservado.' : 'Gateway reativado. Valide a conexão antes de usar em um funil.')
    await load()
  }

  const disconnect = async (gateway: GatewayConnection) => {
    if (testing) return
    setError(null)
    const { error: rpcError } = await db.rpc('disconnect_dynamic_gateway', { p_gateway_id: gateway.id })
    if (rpcError) { setError(rpcError.message); return }
    setMessage('Gateway desconectado. O histórico financeiro foi preservado.')
    await load()
  }

  return (
    <section className="w-full rounded-xl border border-neutral-800 bg-neutral-950 p-5 md:p-6 space-y-5">
      <header className="flex items-center justify-between gap-3 border-b border-neutral-900 pb-4">
        <div className="flex items-center gap-3"><Cpu className="h-4 w-4 text-[#1DB854]"/><div><h3 className="text-xs font-semibold uppercase tracking-wider font-mono text-white">Central de Gateways</h3><p className="mt-1 text-[11px] text-neutral-500">Cadastre conexões reais. O provider/adaptador é apenas a tecnologia de integração.</p></div></div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-lg border border-neutral-800 p-2 text-neutral-400 hover:text-white disabled:opacity-50" aria-label="Atualizar gateways"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}/></button>
      </header>

      {message && <div className="flex items-center gap-2 rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3 text-xs text-emerald-400"><CheckCircle2 className="h-4 w-4"/>{message}</div>}
      {error && <div className="flex items-center gap-2 rounded-lg border border-rose-900/50 bg-rose-950/20 p-3 text-xs text-rose-400"><AlertCircle className="h-4 w-4"/>{error}</div>}

      <div className="space-y-3">
        <div className="flex items-center justify-between"><h4 className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">Gateways conectados</h4><span className="text-[9px] font-mono text-neutral-600">{connections.length} conexão(ões)</span></div>
        {connections.length === 0 ? <div className="rounded-lg border border-dashed border-neutral-800 bg-neutral-950 p-4 text-xs text-neutral-500">Nenhum gateway cadastrado. Adicione uma conexão abaixo.</div> : <div className="space-y-2">{connections.map(gateway => { const connected = ['connected','degraded'].includes(gateway.status.toLowerCase()); return <div key={gateway.id} className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3"><div className="min-w-0"><div className="truncate text-xs font-semibold text-white">{gateway.display_name || 'Gateway sem nome'}</div><div className="mt-1 text-[9px] font-mono uppercase text-neutral-500">{gateway.environment} · {statusLabel(gateway.status)}</div></div><div className="flex shrink-0 items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-neutral-600'}`} /><button type="button" onClick={() => edit(gateway)} className="rounded-md border border-neutral-700 p-2 text-neutral-300 hover:bg-neutral-800" aria-label="Editar gateway"><Pencil className="h-3.5 w-3.5"/></button><button type="button" onClick={() => void testConnection(gateway.id)} disabled={testing !== null} className="rounded-md border border-neutral-700 px-2.5 py-2 text-[9px] font-bold font-mono text-white disabled:opacity-40">{testing === gateway.id ? <Loader2 className="h-3 w-3 animate-spin"/> : 'TESTAR'}</button><button type="button" onClick={() => void toggle(gateway)} disabled={testing !== null || !gateway.credential_id} className="rounded-md border border-neutral-700 p-2 text-neutral-300 hover:bg-neutral-800 disabled:opacity-40" aria-label="Ativar ou desativar gateway"><Power className="h-3.5 w-3.5"/></button><button type="button" onClick={() => void disconnect(gateway)} disabled={testing !== null} className="rounded-md border border-neutral-700 p-2 text-neutral-300 hover:bg-neutral-800 disabled:opacity-40" aria-label="Desconectar gateway"><Unplug className="h-3.5 w-3.5"/></button></div></div> })}</div>}
      </div>

      {!loading && <form onSubmit={submit} className="space-y-4 border-t border-neutral-900 pt-5">
        <div className="flex items-center justify-between"><div><h4 className="text-[10px] font-medium uppercase tracking-wide text-neutral-200">{editingGatewayId ? 'Editar conexão' : 'Nova conexão de gateway'}</h4><p className="mt-1 text-[10px] text-neutral-600">O nome abaixo identifica o gateway que você cadastrou, não o adapter.</p></div>{editingGatewayId && <button type="button" onClick={resetForm} className="text-neutral-500 hover:text-white" aria-label="Cancelar edição"><X className="h-4 w-4"/></button>}</div>
        <label className="block space-y-1.5"><span className="text-[10px] font-mono uppercase text-neutral-400">Nome do gateway</span><input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Ex.: Meu Gateway de Produção" className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-2.5 text-xs text-white outline-none placeholder:text-neutral-700" /></label>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="space-y-1.5"><span className="text-[10px] font-mono uppercase text-neutral-400">Método de integração</span><select value={selectedProviderKey} onChange={e => setSelectedProviderKey(e.target.value)} disabled={!!editingGatewayId} className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-2.5 text-xs text-white outline-none disabled:opacity-60"><option value="">Selecione como a API será integrada...</option>{providers.map(provider => <option key={provider.id} value={provider.provider_key}>{friendlyAdapterName(provider)}</option>)}</select><span className="block text-[9px] text-neutral-600">Isso define o adaptador de comunicação. O gateway real é definido pelo nome e pelas credenciais.</span></label>
          <label className="space-y-1.5"><span className="text-[10px] font-mono uppercase text-neutral-400">Ambiente</span><select value={environment} onChange={e => setEnvironment(e.target.value as 'sandbox' | 'production')} className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-2.5 text-xs text-white outline-none"><option value="production">Produção</option><option value="sandbox">Sandbox / Testes</option></select></label>
        </div>
        {activeProvider && <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-3"><div className="flex items-center gap-2"><Plus className="h-3.5 w-3.5 text-[#1DB854]"/><span className="text-[10px] font-mono uppercase text-neutral-300">Credenciais da conexão</span></div>{activeProvider.credential_schema.fields.map(field => <label key={field.name} className="block space-y-1.5"><span className="text-[10px] font-mono uppercase text-neutral-500">{field.label}{field.required ? ' *' : ''}</span><input type={field.type} value={formValues[field.name] ?? ''} onChange={e => setFormValues(v => ({ ...v, [field.name]: e.target.value }))} placeholder={field.name} autoComplete="off" className="w-full rounded-lg border border-neutral-800 bg-neutral-950 p-2.5 text-xs text-white outline-none placeholder:text-neutral-700" /></label>)}</div>}
        <button type="submit" disabled={saving || !activeProvider} className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-700/60 bg-emerald-950/30 px-4 py-3 text-xs font-bold uppercase tracking-wide text-emerald-300 hover:bg-emerald-950/50 disabled:cursor-not-allowed disabled:opacity-40">{saving && <Loader2 className="h-4 w-4 animate-spin"/>}{editingGatewayId ? 'Salvar alterações' : 'Cadastrar gateway'}</button>
      </form>}
    </section>
  )
}
