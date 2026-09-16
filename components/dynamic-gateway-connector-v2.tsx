'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Cpu, Loader2, Pencil, Power, RefreshCw, Unplug, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Field = { name: string; label: string; type: 'text' | 'password'; required: boolean }
type Provider = { id: string; provider_key: string; display_name: string; credential_schema: { fields: Field[] }; operational: boolean; is_custom_or_webhook_only: boolean; adapter_key?: string | null; adapter_contract_version?: number | null }
type Gateway = { id: string; display_name: string | null; provider: string; environment: 'sandbox' | 'production'; status: string; credential_id: string | null }

const PRIMARY = ['public_key', 'access_token', 'client_id', 'client_secret']
const adapterName = (p: Provider) => p.provider_key === 'generic_http' || p.adapter_key === 'generic_http_json' ? 'API REST / HTTP genérica' : p.display_name
const validSchema = (v: unknown): v is { fields: Field[] } => !!v && typeof v === 'object' && Array.isArray((v as { fields?: unknown }).fields) && (v as { fields: unknown[] }).fields.every(f => !!f && typeof f === 'object' && typeof (f as Record<string, unknown>).name === 'string' && typeof (f as Record<string, unknown>).label === 'string' && ((f as Record<string, unknown>).type === 'text' || (f as Record<string, unknown>).type === 'password') && typeof (f as Record<string, unknown>).required === 'boolean')
const statusLabel = (s: string) => ({ connected: 'CONECTADO', degraded: 'DEGRADADO', error: 'ERRO', disabled: 'DESATIVADO', connecting: 'CONECTANDO' } as Record<string, string>)[s.toLowerCase()] ?? 'NÃO VALIDADO'

export const DynamicGatewayConnectorV2: React.FC = () => {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [providers, setProviders] = useState<Provider[]>([]), [gateways, setGateways] = useState<Gateway[]>([])
  const [providerKey, setProviderKey] = useState(''), [name, setName] = useState(''), [environment, setEnvironment] = useState<'sandbox'|'production'>('production')
  const [values, setValues] = useState<Record<string,string>>({}), [editing, setEditing] = useState<string|null>(null)
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [testing, setTesting] = useState<string|null>(null)
  const [message, setMessage] = useState<string|null>(null), [error, setError] = useState<string|null>(null)

  const load = async () => {
    setLoading(true); setError(null)
    const { data: auth, error: authError } = await db.auth.getUser()
    if (authError || !auth.user?.id) { setLoading(false); if (authError) setError(authError.message); return }
    const [r, g] = await Promise.all([
      db.from('gateway_provider_registry').select('id,provider_key,display_name,credential_schema,operational,is_custom_or_webhook_only,adapter_key,adapter_contract_version').eq('is_active', true).order('display_name'),
      db.from('gateways').select('id,display_name,provider,environment,status,credential_id').order('created_at', { ascending: false })
    ])
    if (r.error) setError(r.error.message); else {
      const list = (r.data ?? []).filter(p => validSchema(p.credential_schema) && p.operational && p.provider_key !== 'custom_rest').sort((a,b) => Number(b.adapter_contract_version ?? 0) - Number(a.adapter_contract_version ?? 0)) as Provider[]
      setProviders(list.filter((p,i,a) => a.findIndex(x => (x.adapter_key || x.provider_key) === (p.adapter_key || p.provider_key)) === i))
    }
    if (g.error) setError(e => e ?? g.error!.message); else setGateways((g.data ?? []) as Gateway[])
    setLoading(false)
  }
  useEffect(() => { void load() }, [])
  const active = providers.find(p => p.provider_key === providerKey) ?? null
  useEffect(() => { const x: Record<string,string> = {}; for (const f of active?.credential_schema.fields ?? []) x[f.name] = ''; setValues(x) }, [active])
  const reset = () => { setEditing(null); setProviderKey(''); setName(''); setEnvironment('production'); setValues({}) }
  const test = async (id: string) => { setTesting(id); setError(null); try { const {data,error:e}=await db.functions.invoke('gateway-connection-test',{body:{gateway_id:id}}); if(e) throw new Error(e.message); if(!data?.ok) throw new Error(data?.error || 'Falha ao validar a conexão.'); setMessage(`Gateway validado${typeof data.latency_ms === 'number' ? ` · ${data.latency_ms}ms` : ''}.`); await load() } catch(e) { setError(e instanceof Error ? e.message : 'Não foi possível validar o gateway.'); await load() } finally { setTesting(null) } }
  const submit = async (e: React.FormEvent) => { e.preventDefault(); if(!active || saving) return; setSaving(true); setError(null); setMessage(null); try {
    if(!name.trim()) throw new Error('Dê um nome para esta conexão de gateway.')
    if(!editing) for(const f of active.credential_schema.fields) if(f.required && !values[f.name]?.trim()) throw new Error(`Preencha: ${f.label}.`)
    const rpc = editing ? await db.rpc('update_dynamic_gateway',{p_gateway_id:editing,p_display_name:name.trim(),p_environment:environment,p_credentials:Object.values(values).some(v=>v.trim())?values:{}}) : await db.rpc('register_dynamic_gateway',{p_provider_key:active.provider_key,p_display_name:name.trim(),p_environment:environment,p_credentials:values,p_metadata:{source:'althea_gateway_connection_v6'}})
    if(rpc.error) throw new Error(rpc.error.message)
    const id = typeof rpc.data?.gateway_id === 'string' ? rpc.data.gateway_id : editing
    setMessage(editing ? 'Gateway atualizado. Validando a configuração.' : 'Gateway cadastrado. Validando a conexão.')
    await load(); if(id) await test(id); reset()
  } catch(e) { setError(e instanceof Error ? e.message : 'Falha ao salvar o gateway.') } finally { setSaving(false) } }
  const edit = (g: Gateway) => { setEditing(g.id); setProviderKey(g.provider); setName(g.display_name ?? ''); setEnvironment(g.environment); setError(null); setMessage(null) }
  const toggle = async (g: Gateway) => { if(!g.credential_id || testing) return; const enabled=!['disabled','inactive'].includes(g.status.toLowerCase()); const {error:e}=await db.rpc('set_gateway_credential_status',{p_credential_id:g.credential_id,p_is_active:!enabled}); if(e){setError(e.message);return}; const u=await db.from('gateways').update({status:enabled?'disabled':'inactive'}).eq('id',g.id); if(u.error){setError(u.error.message);return}; setMessage(enabled?'Gateway desativado.':'Gateway reativado.'); await load() }
  const disconnect = async (g: Gateway) => { if(testing) return; const {error:e}=await db.rpc('disconnect_dynamic_gateway',{p_gateway_id:g.id}); if(e){setError(e.message);return}; setMessage('Gateway desconectado. O histórico financeiro foi preservado.'); await load() }
  const primary = active?.credential_schema.fields.filter(f => PRIMARY.includes(f.name)) ?? [], advanced = active?.credential_schema.fields.filter(f => !PRIMARY.includes(f.name)) ?? []
  const field = (f: Field) => <label key={f.name} className="block space-y-1.5"><span className="text-[10px] font-mono uppercase text-neutral-400">{f.label}{f.required?' *':''}</span><input type={f.type} value={values[f.name]??''} onChange={e=>setValues(v=>({...v,[f.name]:e.target.value}))} autoComplete="off" className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm text-white outline-none focus:border-emerald-700" /></label>

  return <section className="w-full rounded-xl border border-neutral-800 bg-neutral-950 p-5 md:p-6 space-y-5">
    <header className="flex items-center justify-between gap-3 border-b border-neutral-900 pb-4"><div className="flex items-center gap-3"><Cpu className="h-4 w-4 text-[#1DB854]"/><div><h3 className="text-xs font-semibold uppercase tracking-wider font-mono text-white">Central de Gateways</h3><p className="mt-1 text-[11px] text-neutral-500">Credenciais principais do gateway. Configurações técnicas ficam em Avançado.</p></div></div><button type="button" onClick={()=>void load()} disabled={loading} className="rounded-lg border border-neutral-800 p-2 text-neutral-400"><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`}/></button></header>
    {message&&<div className="flex items-center gap-2 rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3 text-xs text-emerald-400"><CheckCircle2 className="h-4 w-4"/>{message}</div>}{error&&<div className="flex items-center gap-2 rounded-lg border border-rose-900/50 bg-rose-950/20 p-3 text-xs text-rose-400"><AlertCircle className="h-4 w-4"/>{error}</div>}
    <div className="space-y-3"><div className="flex items-center justify-between"><h4 className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">Gateways conectados</h4><span className="text-[9px] font-mono text-neutral-600">{gateways.length} conexão(ões)</span></div>{gateways.length===0?<div className="rounded-lg border border-dashed border-neutral-800 p-4 text-xs text-neutral-500">Nenhum gateway cadastrado. Adicione uma conexão abaixo.</div>:<div className="space-y-2">{gateways.map(g=><div key={g.id} className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 p-3"><div className="min-w-0"><div className="truncate text-xs font-semibold text-white">{g.display_name||'Gateway sem nome'}</div><div className="mt-1 text-[9px] font-mono uppercase text-neutral-500">{g.environment} · {statusLabel(g.status)}</div></div><div className="flex shrink-0 items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${['connected','degraded'].includes(g.status.toLowerCase())?'bg-emerald-500':'bg-neutral-600'}`}/><button type="button" onClick={()=>edit(g)} className="rounded-md border border-neutral-700 p-2 text-neutral-300"><Pencil className="h-3.5 w-3.5"/></button><button type="button" onClick={()=>void test(g.id)} disabled={testing!==null} className="rounded-md border border-neutral-700 px-2.5 py-2 text-[9px] font-bold font-mono text-white">{testing===g.id?<Loader2 className="h-3 w-3 animate-spin"/>:'TESTAR'}</button><button type="button" onClick={()=>void toggle(g)} disabled={testing!==null||!g.credential_id} className="rounded-md border border-neutral-700 p-2 text-neutral-300"><Power className="h-3.5 w-3.5"/></button><button type="button" onClick={()=>void disconnect(g)} disabled={testing!==null} className="rounded-md border border-neutral-700 p-2 text-neutral-300"><Unplug className="h-3.5 w-3.5"/></button></div></div>)}</div>}</div>
    {!loading&&<form onSubmit={submit} className="space-y-5 border-t border-neutral-900 pt-5"><div className="flex items-center justify-between"><div><h4 className="text-[10px] font-medium uppercase tracking-wide text-neutral-200">{editing?'Editar conexão':'Nova conexão de gateway'}</h4><p className="mt-1 text-[10px] text-neutral-600">O nome identifica o gateway real; o método de integração define apenas como a API será acessada.</p></div>{editing&&<button type="button" onClick={reset} className="text-neutral-500"><X className="h-4 w-4"/></button>}</div>
      <label className="block space-y-1.5"><span className="text-[10px] font-mono uppercase text-neutral-400">Nome do gateway</span><input value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Mercado Pago" className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm text-white outline-none"/></label>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><label className="space-y-1.5"><span className="text-[10px] font-mono uppercase text-neutral-400">Método de integração</span><select value={providerKey} onChange={e=>setProviderKey(e.target.value)} disabled={!!editing} className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm text-white outline-none"><option value="">Selecione como a API será integrada...</option>{providers.map(p=><option key={p.id} value={p.provider_key}>{adapterName(p)}</option>)}</select></label><label className="space-y-1.5"><span className="text-[10px] font-mono uppercase text-neutral-400">Ambiente</span><select value={environment} onChange={e=>setEnvironment(e.target.value as 'sandbox'|'production')} className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm text-white outline-none"><option value="production">Produção</option><option value="sandbox">Sandbox / Testes</option></select></label></div>
      {active&&primary.length>0&&<div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4"><div><h5 className="text-xs font-semibold uppercase tracking-wide text-white">Credenciais</h5><p className="mt-1 text-[10px] text-neutral-500">Use exatamente os dados fornecidos pelo gateway.</p></div><div className="grid grid-cols-1 gap-4 md:grid-cols-2">{primary.map(field)}</div></div>}
      {active&&advanced.length>0&&<details className="rounded-xl border border-neutral-800 p-4"><summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-neutral-300">Configuração técnica avançada</summary><p className="mt-2 text-[10px] text-neutral-600">URL, webhook e parâmetros específicos da API ficam aqui para não poluir o cadastro principal.</p><div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">{advanced.map(field)}</div></details>}
      <button type="submit" disabled={!active||saving} className="w-full rounded-lg border border-emerald-800 bg-emerald-950/30 p-3 text-xs font-bold uppercase tracking-wider text-emerald-400 disabled:opacity-40">{saving?'SALVANDO...':editing?'SALVAR ALTERAÇÕES':'CADASTRAR GATEWAY'}</button>
    </form>}
  </section>
}
