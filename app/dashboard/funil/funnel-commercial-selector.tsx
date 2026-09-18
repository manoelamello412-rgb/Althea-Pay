'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Loader2, Package, RefreshCw, Zap } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Product = { id: string; name: string; unit_amount: number; currency: string; status: string }
type Gateway = { id: string; display_name: string | null; provider: string | null; environment: string | null; status: string | null }

export type FunnelCommercialSelection = { productId: string; gatewayId: string }

export default function FunnelCommercialSelector({ value, onChange }: { value: FunnelCommercialSelection; onChange: (value: FunnelCommercialSelection) => void }) {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [products, setProducts] = useState<Product[]>([])
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true); setError('')
    try {
      const { data: auth, error: authError } = await db.auth.getUser()
      if (authError || !auth.user) throw new Error('Sessão expirada. Faça login novamente.')
      const [{ data: productRows, error: productError }, { data: gatewayRows, error: gatewayError }] = await Promise.all([
        db.from('products').select('id,name,unit_amount,currency,status').eq('status', 'active').is('deleted_at', null).order('name', { ascending: true }),
        db.from('gateways').select('id,display_name,provider,environment,status').order('priority', { ascending: true }),
      ])
      if (productError) throw productError
      if (gatewayError) throw gatewayError
      setProducts((productRows ?? []) as Product[])
      setGateways(((gatewayRows ?? []) as Gateway[]).filter((gateway) => ['connected', 'degraded'].includes(String(gateway.status ?? '').toLowerCase())))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar produtos e gateways.')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const selectedProduct = products.find((item) => item.id === value.productId)
  const selectedGateway = gateways.find((item) => item.id === value.gatewayId)
  const ready = Boolean(value.productId && value.gatewayId)

  return (
    <section className="space-y-3 rounded-2xl border border-emerald-500/15 bg-[#0c0c0e] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10"><Package className="h-4 w-4 text-emerald-400" /></div>
          <div><h3 className="text-xs font-bold text-zinc-200">Comercial do Funil</h3><p className="text-[9px] text-zinc-500">Produto e gateway são obrigatórios para ativação.</p></div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} aria-label="Atualizar produtos e gateways" className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.06] text-zinc-500 hover:text-white disabled:opacity-40"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>
      {error && <div className="rounded-lg border border-rose-500/20 bg-rose-950/20 p-2 text-[10px] text-rose-300">{error}</div>}
      {loading ? <div className="flex h-16 items-center justify-center text-[10px] text-zinc-500"><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Carregando opções comerciais...</div> : <>
        <label className="block space-y-1.5"><span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Produto *</span><div className="relative"><select required value={value.productId} onChange={(event) => onChange({ ...value, productId: event.target.value })} className="h-11 w-full appearance-none rounded-xl border border-white/[0.06] bg-[#121214] px-3 pr-9 text-xs text-zinc-200 outline-none focus:border-emerald-500/40"><option value="">Selecione o produto ativo</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: product.currency }).format(Number(product.unit_amount))}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-zinc-600" /></div></label>
        {selectedProduct && <div className="flex items-center gap-2 rounded-xl border border-white/[0.04] bg-[#121214] px-3 py-2"><Check className="h-3.5 w-3.5 text-emerald-400" /><span className="text-[10px] text-zinc-300">{selectedProduct.name}</span><span className="ml-auto text-[9px] font-mono text-zinc-500">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: selectedProduct.currency }).format(Number(selectedProduct.unit_amount))}</span></div>}
        <label className="block space-y-1.5"><span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Gateway de pagamento *</span><div className="relative"><select required value={value.gatewayId} onChange={(event) => onChange({ ...value, gatewayId: event.target.value })} className="h-11 w-full appearance-none rounded-xl border border-white/[0.06] bg-[#121214] px-3 pr-9 text-xs text-zinc-200 outline-none focus:border-emerald-500/40"><option value="">Selecione o gateway conectado</option>{gateways.map((gateway) => <option key={gateway.id} value={gateway.id}>{gateway.display_name || gateway.provider || gateway.id} · {gateway.environment || 'default'}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-zinc-600" /></div></label>
        {selectedGateway && <div className="flex items-center gap-2 rounded-xl border border-white/[0.04] bg-[#121214] px-3 py-2"><Zap className="h-3.5 w-3.5 text-emerald-400" /><span className="text-[10px] text-zinc-300">{selectedGateway.display_name || selectedGateway.provider || selectedGateway.id}</span><span className="ml-auto text-[8px] font-mono text-zinc-600">{selectedGateway.provider || 'provider-agnostic'} · {selectedGateway.environment || 'default'}</span></div>}
        {products.length === 0 && <div className="rounded-xl border border-amber-500/15 bg-amber-950/10 p-3 text-[10px] text-amber-300">Nenhum produto ativo disponível. Ative um produto antes de criar o funil.</div>}
        {gateways.length === 0 && <div className="rounded-xl border border-amber-500/15 bg-amber-950/10 p-3 text-[10px] text-amber-300">Nenhum gateway validado disponível. Conecte e valide um gateway antes de criar o funil.</div>}
        <div className={`flex items-center gap-2 rounded-xl border p-2.5 text-[9px] ${ready ? 'border-emerald-500/15 bg-emerald-950/10 text-emerald-300' : 'border-white/[0.04] bg-[#121214] text-zinc-500'}`}><span className={`h-1.5 w-1.5 rounded-full ${ready ? 'bg-emerald-500' : 'bg-zinc-700'}`} />{ready ? 'Produto + Gateway selecionados. O vínculo será criado atomicamente com o funil.' : 'Selecione Produto e Gateway para habilitar a criação.'}</div>
      </>}
    </section>
  )
}
