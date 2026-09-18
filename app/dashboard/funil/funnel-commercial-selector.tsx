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
        db.from('gateways').select('id,display_name,provider,environment,status').order('display_name', { ascending: true }),
      ])
      if (productError) throw productError
      if (gatewayError) throw gatewayError
      setProducts((productRows ?? []) as Product[])
      setGateways(((gatewayRows ?? []) as Gateway[]).filter((gateway) => !['disabled', 'inactive', 'disconnected'].includes(String(gateway.status ?? '').toLowerCase())))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar produtos e gateways.')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const selectedProduct = products.find((item) => item.id === value.productId)
  const selectedGateway = gateways.find((item) => item.id === value.gatewayId)
  const configured = Boolean(value.productId || value.gatewayId)

  return (
    <section className="space-y-3 rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgba(29,184,84,.055)]"><Package className="h-4 w-4 text-[var(--althea-brand)]" /></div>
          <div><h3 className="text-xs font-bold text-white">Comercial do Funil</h3><p className="text-[9px] text-[var(--althea-muted)]">Opcional nesta etapa. Produto e gateway podem ser vinculados agora ou depois.</p></div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} aria-label="Atualizar produtos e gateways" className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[.055] text-[var(--althea-muted)] hover:text-white disabled:opacity-40"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>
      {error && <div className="rounded-lg border border-rose-500/20 bg-rose-950/20 p-2 text-[10px] text-rose-300">{error}</div>}
      {loading ? <div className="flex h-16 items-center justify-center text-[10px] text-[var(--althea-muted)]"><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Carregando opções comerciais...</div> : <>
        <label className="block space-y-1.5"><span className="text-[9px] font-bold uppercase tracking-wider text-[var(--althea-muted)]">Produto · opcional</span><div className="relative"><select value={value.productId} onChange={(event) => onChange({ ...value, productId: event.target.value })} className="h-11 w-full appearance-none rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3 pr-9 text-xs text-white outline-none focus:border-[rgba(29,184,84,.32)]"><option value="">Configurar depois</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: product.currency }).format(Number(product.unit_amount))}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-[#5f6e66]" /></div></label>
        {selectedProduct && <div className="flex items-center gap-2 rounded-xl border border-white/[.045] bg-[var(--althea-bg)] px-3 py-2"><Check className="h-3.5 w-3.5 text-[var(--althea-brand)]" /><span className="text-[10px] text-[#c8d2cc]">{selectedProduct.name}</span><span className="ml-auto text-[9px] font-mono text-[var(--althea-muted)]">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: selectedProduct.currency }).format(Number(selectedProduct.unit_amount))}</span></div>}
        <label className="block space-y-1.5"><span className="text-[9px] font-bold uppercase tracking-wider text-[var(--althea-muted)]">Gateway de pagamento · opcional</span><div className="relative"><select value={value.gatewayId} onChange={(event) => onChange({ ...value, gatewayId: event.target.value })} className="h-11 w-full appearance-none rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3 pr-9 text-xs text-white outline-none focus:border-[rgba(29,184,84,.32)]"><option value="">Configurar depois</option>{gateways.map((gateway) => <option key={gateway.id} value={gateway.id}>{gateway.display_name || gateway.provider || gateway.id} · {gateway.environment || 'default'}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-[#5f6e66]" /></div></label>
        {selectedGateway && <div className="flex items-center gap-2 rounded-xl border border-white/[.045] bg-[var(--althea-bg)] px-3 py-2"><Zap className="h-3.5 w-3.5 text-[var(--althea-brand)]" /><span className="text-[10px] text-[#c8d2cc]">{selectedGateway.display_name || selectedGateway.provider || selectedGateway.id}</span><span className="ml-auto text-[8px] font-mono text-[#5f6e66]">{selectedGateway.provider || 'provider-agnostic'} · {selectedGateway.environment || 'default'}</span></div>}
        {products.length === 0 && <div className="rounded-xl border border-amber-500/15 bg-amber-950/10 p-3 text-[10px] text-amber-300">Nenhum produto ativo disponível. Você pode conectar o funil agora e cadastrar o produto depois.</div>}
        {gateways.length === 0 && <div className="rounded-xl border border-amber-500/15 bg-amber-950/10 p-3 text-[10px] text-amber-300">Nenhum gateway operacional disponível. Você pode conectar o funil agora e adicionar o gateway depois.</div>}
        <div className={`flex items-center gap-2 rounded-xl border p-2.5 text-[9px] ${configured ? 'border-[rgba(29,184,84,.14)] bg-[rgba(29,184,84,.045)] text-[#8edca5]' : 'border-white/[.045] bg-[var(--althea-bg)] text-[var(--althea-muted)]'}`}><span className={`h-1.5 w-1.5 rounded-full ${configured ? 'bg-[var(--althea-brand)]' : 'bg-zinc-700'}`} />{configured ? 'Os vínculos selecionados serão persistidos atomicamente. Os demais podem ser configurados depois.' : 'Nenhum vínculo comercial é necessário para conectar a fonte.'}</div>
      </>}
    </section>
  )
}
