'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Cpu, Loader2, Plus, RefreshCw } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export interface SchemaField {
  name: string
  label: string
  type: 'text' | 'password'
  required: boolean
}

export interface ProviderRegistry {
  id: string
  provider_key: string
  display_name: string
  credential_schema: { fields: SchemaField[] }
  capabilities: Record<string, unknown>
  operational: boolean
  is_custom_or_webhook_only: boolean
}

function validSchema(value: unknown): value is { fields: SchemaField[] } {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { fields?: unknown }).fields)) return false
  return (value as { fields: unknown[] }).fields.every((field) => {
    if (!field || typeof field !== 'object') return false
    const f = field as Record<string, unknown>
    return typeof f.name === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(f.name)
      && typeof f.label === 'string' && (f.type === 'text' || f.type === 'password')
      && typeof f.required === 'boolean'
  })
}

export const DynamicGatewayConnector: React.FC = () => {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [providers, setProviders] = useState<ProviderRegistry[]>([])
  const [selectedProviderKey, setSelectedProviderKey] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('production')
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const loadRegistry = async () => {
    setLoading(true)
    setErrorMessage(null)
    const { data, error } = await db
      .from('gateway_provider_registry')
      .select('id,provider_key,display_name,credential_schema,capabilities,operational,is_custom_or_webhook_only')
      .eq('is_active', true)
      .order('display_name', { ascending: true })
    if (error) {
      setErrorMessage(error.message)
      setProviders([])
    } else {
      setProviders((data ?? []).filter((p): p is ProviderRegistry => validSchema(p.credential_schema)))
    }
    setLoading(false)
  }

  useEffect(() => { void loadRegistry() }, [])

  const activeProvider = useMemo(
    () => providers.find((provider) => provider.provider_key === selectedProviderKey) ?? null,
    [providers, selectedProviderKey],
  )

  useEffect(() => {
    if (!activeProvider) {
      setFormValues({})
      return
    }
    const values: Record<string, string> = {}
    for (const field of activeProvider.credential_schema.fields) values[field.name] = ''
    setFormValues(values)
  }, [activeProvider])

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!activeProvider || submitting) return
    setSubmitting(true)
    setMessage(null)
    setErrorMessage(null)
    try {
      if (!displayName.trim()) throw new Error('Informe um nome para o gateway.')
      for (const field of activeProvider.credential_schema.fields) {
        if (field.required && !formValues[field.name]?.trim()) throw new Error(`Preencha: ${field.label}.`)
      }
      const { data, error } = await db.rpc('register_dynamic_gateway', {
        p_provider_key: activeProvider.provider_key,
        p_display_name: displayName.trim(),
        p_environment: environment,
        p_credentials: formValues,
        p_metadata: { source: 'dynamic_gateway_connector_v1' },
      })
      if (error) throw new Error(error.message)
      const result = data && typeof data === 'object' ? data as Record<string, unknown> : {}
      setMessage(
        result.operational === true
          ? 'Gateway conectado e registrado no Core.'
          : 'Credenciais armazenadas com segurança. Este provider ainda não possui adapter operacional homologado.',
      )
      setSelectedProviderKey('')
      setDisplayName('')
      setFormValues({})
      await loadRegistry()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao registrar o gateway.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="w-full rounded-xl border border-neutral-800 bg-[#0c0c0e] p-5 md:p-6 space-y-5">
      <header className="flex items-center justify-between gap-3 border-b border-neutral-900 pb-4">
        <div className="flex items-center gap-3">
          <Cpu className="h-4 w-4 text-[#1DB854]" />
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider font-mono text-white">Conector Dinâmico de Gateways</h3>
            <p className="mt-1 text-[11px] text-neutral-500">O formulário é derivado do catálogo; os segredos seguem diretamente para o Vault.</p>
          </div>
        </div>
        <button type="button" onClick={() => void loadRegistry()} disabled={loading} className="rounded-lg border border-neutral-800 p-2 text-neutral-400 hover:text-white disabled:opacity-50" aria-label="Atualizar catálogo">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {message && <div className="flex items-center gap-2 rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3 text-xs text-emerald-400"><CheckCircle2 className="h-4 w-4" />{message}</div>}
      {errorMessage && <div className="flex items-center gap-2 rounded-lg border border-rose-900/50 bg-rose-950/20 p-3 text-xs text-rose-400"><AlertCircle className="h-4 w-4" />{errorMessage}</div>}

      {loading ? <div className="h-11 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" /> : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="space-y-1.5 md:col-span-1">
              <span className="text-[10px] font-mono uppercase text-neutral-400">Provedor</span>
              <select value={selectedProviderKey} onChange={(e) => setSelectedProviderKey(e.target.value)} className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-2.5 text-xs text-white outline-none">
                <option value="">Selecione um provider...</option>
                {providers.map((provider) => <option key={provider.id} value={provider.provider_key}>{provider.display_name}{provider.operational ? '' : ' — adapter pendente'}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 md:col-span-1">
              <span className="text-[10px] font-mono uppercase text-neutral-400">Nome da conexão</span>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={120} className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-2.5 text-xs text-white outline-none" placeholder="Ex.: Stripe Principal" required />
            </label>
            <label className="space-y-1.5 md:col-span-1">
              <span className="text-[10px] font-mono uppercase text-neutral-400">Ambiente</span>
              <select value={environment} onChange={(e) => setEnvironment(e.target.value === 'sandbox' ? 'sandbox' : 'production')} className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-2.5 text-xs text-white outline-none">
                <option value="production">Produção</option>
                <option value="sandbox">Sandbox</option>
              </select>
            </label>
          </div>

          {activeProvider && (
            <div className="space-y-4 border-t border-neutral-900 pt-4">
              {activeProvider.credential_schema.fields.map((field) => (
                <label key={field.name} className="block space-y-1.5">
                  <span className="text-[10px] font-mono uppercase text-neutral-400">{field.label} {field.required && <b className="text-[#1DB854]">*</b>}</span>
                  <input type={field.type} autoComplete="new-password" value={formValues[field.name] ?? ''} onChange={(e) => setFormValues((previous) => ({ ...previous, [field.name]: e.target.value }))} className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-2.5 text-xs font-mono text-white outline-none focus:border-neutral-700" required={field.required} />
                </label>
              ))}
              <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-lg bg-white py-2.5 text-xs font-bold font-mono text-black transition hover:bg-neutral-200 disabled:opacity-40">
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                {submitting ? 'REGISTRANDO COM SEGURANÇA...' : `CONECTAR ${activeProvider.display_name.toUpperCase()}`}
              </button>
            </div>
          )}
        </form>
      )}
    </section>
  )
}
