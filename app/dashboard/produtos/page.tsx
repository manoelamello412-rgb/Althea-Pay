'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, Check, Package, Plus, RefreshCw, RotateCcw, Save, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Product = { id: string; name: string; slug: string; description: string | null; product_type: string | null; status: 'draft'|'active'|'paused'|'archived'; billing_type: 'one_time'|'subscription'|'free'; billing_interval: string | null; interval_count: number | null; unit_amount: number; currency: string; sku: string | null; metadata: Record<string, unknown>; version: number; created_at: string; updated_at: string }

type FormState = { name: string; slug: string; description: string; product_type: string; billing_type: 'one_time'|'subscription'|'free'; unit_amount: string; currency: string; billing_interval: string; interval_count: string; sku: string }
const emptyForm: FormState = { name:'', slug:'', description:'', product_type:'digital', billing_type:'one_time', unit_amount:'0', currency:'BRL', billing_interval:'month', interval_count:'1', sku:'' }

const money = (value: number, currency: string) => new Intl.NumberFormat('pt-BR', { style:'currency', currency, minimumFractionDigits:2 }).format(value)

export default function ProductsPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [products, setProducts] = useState<Product[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editing, setEditing] = useState<Product | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const { data: auth } = await db.auth.getUser()
    if (!auth.user) { setProducts([]); setLoading(false); return }
    const { data, error: queryError } = await db.from('products').select('id,name,slug,description,product_type,status,billing_type,billing_interval,interval_count,unit_amount,currency,sku,metadata,version,created_at,updated_at').order('created_at', { ascending:false })
    if (queryError) setError(queryError.message); else setProducts((data ?? []) as Product[])
    setLoading(false)
  }, [db])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const channel = db.channel('products-workspace').on('postgres_changes', { event:'*', schema:'public', table:'products' }, () => { void load() }).subscribe()
    return () => { void db.removeChannel(channel) }
  }, [db, load])

  const openCreate = () => { setEditing(null); setForm(emptyForm); setError(''); setNotice(''); setShowForm(true) }
  const openEdit = (p: Product) => { setEditing(p); setForm({ name:p.name, slug:p.slug, description:p.description ?? '', product_type:p.product_type ?? 'digital', billing_type:p.billing_type, unit_amount:String(p.unit_amount ?? 0), currency:p.currency, billing_interval:p.billing_interval ?? 'month', interval_count:String(p.interval_count ?? 1), sku:p.sku ?? '' }); setError(''); setNotice(''); setShowForm(true) }

  const save = async (event: FormEvent) => {
    event.preventDefault(); if (saving) return
    setSaving(true); setError(''); setNotice('')
    const amount = Number(form.unit_amount.replace(',', '.'))
    if (!form.name.trim() || !Number.isFinite(amount) || amount < 0 || !/^[A-Z]{3}$/.test(form.currency)) { setError('Revise nome, preço e moeda antes de salvar.'); setSaving(false); return }
    const common = { p_name:form.name.trim(), p_slug:form.slug.trim() || null, p_description:form.description.trim() || null, p_product_type:form.product_type, p_billing_type:form.billing_type, p_unit_amount:amount, p_currency:form.currency, p_billing_interval:form.billing_type === 'subscription' ? form.billing_interval : null, p_interval_count:form.billing_type === 'subscription' ? Number(form.interval_count || 1) : null, p_sku:form.sku.trim() || null, p_metadata:{} }
    const result = editing
      ? await db.rpc('update_product', { p_product_id:editing.id, p_version:editing.version, ...common, p_status:editing.status })
      : await db.rpc('create_product', common)
    if (result.error) setError(result.error.message); else { setNotice(editing ? 'Produto atualizado.' : 'Produto criado em rascunho.'); setShowForm(false); setEditing(null); setForm(emptyForm); await load() }
    setSaving(false)
  }

  const archive = async (product: Product) => {
    if (!window.confirm(`Arquivar o produto “${product.name}”?`)) return
    setError(''); setNotice('')
    const { error: rpcError } = await db.rpc('archive_product', { p_product_id:product.id, p_version:product.version })
    if (rpcError) setError(rpcError.message); else { setNotice('Produto arquivado.'); await load() }
  }

  const restore = async (product: Product) => {
    setError(''); setNotice('')
    const { error: rpcError } = await db.rpc('restore_product', { p_product_id:product.id, p_version:product.version })
    if (rpcError) setError(rpcError.message); else { setNotice('Produto restaurado como rascunho.'); await load() }
  }

  return <main className="space-y-7">
    <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-[10px] font-bold tracking-[0.22em] text-emerald-400">CATÁLOGO OPERACIONAL</p><h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight text-white"><Package className="h-6 w-6 text-emerald-400" /> Produtos</h1><p className="mt-2 max-w-2xl text-sm text-zinc-400">Cadastre e controle produtos reais da organização. O produto é independente de gateway e pode ser associado a funis e ofertas posteriormente.</p></div>
      <div className="flex gap-2"><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] px-4 py-3 text-sm text-zinc-300 hover:bg-white/[0.04] disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar</button><button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-black hover:bg-emerald-400"><Plus className="h-4 w-4" /> Novo produto</button></div>
    </section>

    {error && <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/[0.06] px-4 py-3 text-sm text-rose-300">{error}</div>}
    {notice && <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3 text-sm text-emerald-300"><Check className="h-4 w-4" />{notice}</div>}

    {showForm && <section className="rounded-2xl border border-white/[0.09] bg-[#0a0d0b] p-5 shadow-2xl">
      <div className="mb-5 flex items-center justify-between"><div><h2 className="text-lg font-semibold text-white">{editing ? 'Editar produto' : 'Novo produto'}</h2><p className="mt-1 text-xs text-zinc-500">Persistência real no PostgreSQL • controle de versão ativo</p></div><button type="button" onClick={() => setShowForm(false)} className="grid h-9 w-9 place-items-center rounded-lg text-zinc-500 hover:bg-white/[0.04] hover:text-white"><X className="h-5 w-5" /></button></div>
      <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5 text-xs text-zinc-400">Nome<input required maxLength={160} value={form.name} onChange={e => setForm({...form,name:e.target.value})} className="w-full rounded-xl border border-white/[0.08] bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-emerald-400/40" /></label>
        <label className="space-y-1.5 text-xs text-zinc-400">Slug<input maxLength={80} value={form.slug} onChange={e => setForm({...form,slug:e.target.value.toLowerCase().replace(/\s+/g,'-')})} placeholder="gerado automaticamente se vazio" className="w-full rounded-xl border border-white/[0.08] bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-emerald-400/40" /></label>
        <label className="space-y-1.5 text-xs text-zinc-400 md:col-span-2">Descrição<textarea maxLength={5000} value={form.description} onChange={e => setForm({...form,description:e.target.value})} rows={3} className="w-full resize-none rounded-xl border border-white/[0.08] bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-emerald-400/40" /></label>
        <label className="space-y-1.5 text-xs text-zinc-400">Tipo<select value={form.product_type} onChange={e => setForm({...form,product_type:e.target.value})} className="w-full rounded-xl border border-white/[0.08] bg-[#0d1210] px-3 py-3 text-sm text-white outline-none"><option value="digital">Digital</option><option value="course">Curso</option><option value="membership">Membership</option><option value="subscription">Assinatura</option><option value="service">Serviço</option><option value="physical">Físico</option><option value="other">Outro</option></select></label>
        <label className="space-y-1.5 text-xs text-zinc-400">Cobrança<select value={form.billing_type} onChange={e => setForm({...form,billing_type:e.target.value as FormState['billing_type']})} className="w-full rounded-xl border border-white/[0.08] bg-[#0d1210] px-3 py-3 text-sm text-white outline-none"><option value="one_time">Pagamento único</option><option value="subscription">Recorrente</option><option value="free">Gratuito</option></select></label>
        <label className="space-y-1.5 text-xs text-zinc-400">Preço<input inputMode="decimal" value={form.unit_amount} onChange={e => setForm({...form,unit_amount:e.target.value})} className="w-full rounded-xl border border-white/[0.08] bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-emerald-400/40" /></label>
        <label className="space-y-1.5 text-xs text-zinc-400">Moeda<input maxLength={3} value={form.currency} onChange={e => setForm({...form,currency:e.target.value.toUpperCase()})} className="w-full rounded-xl border border-white/[0.08] bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-emerald-400/40" /></label>
        {form.billing_type === 'subscription' && <><label className="space-y-1.5 text-xs text-zinc-400">Intervalo<select value={form.billing_interval} onChange={e => setForm({...form,billing_interval:e.target.value})} className="w-full rounded-xl border border-white/[0.08] bg-[#0d1210] px-3 py-3 text-sm text-white outline-none"><option value="day">Dia</option><option value="week">Semana</option><option value="month">Mês</option><option value="year">Ano</option></select></label><label className="space-y-1.5 text-xs text-zinc-400">A cada<input type="number" min={1} value={form.interval_count} onChange={e => setForm({...form,interval_count:e.target.value})} className="w-full rounded-xl border border-white/[0.08] bg-black/20 px-3 py-3 text-sm text-white outline-none" /></label></>}
        <label className="space-y-1.5 text-xs text-zinc-400 md:col-span-2">SKU opcional<input maxLength={120} value={form.sku} onChange={e => setForm({...form,sku:e.target.value})} className="w-full rounded-xl border border-white/[0.08] bg-black/20 px-3 py-3 text-sm text-white outline-none focus:border-emerald-400/40" /></label>
        <div className="md:col-span-2 flex justify-end gap-2 pt-2"><button type="button" onClick={() => setShowForm(false)} className="rounded-xl border border-white/[0.08] px-4 py-3 text-sm text-zinc-300">Cancelar</button><button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-black disabled:cursor-wait disabled:opacity-60"><Save className="h-4 w-4" />{saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Criar produto'}</button></div>
      </form>
    </section>}

    <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#090b0a]">
      <div className="border-b border-white/[0.06] px-5 py-4"><p className="text-[10px] font-bold tracking-[0.18em] text-zinc-500">CATÁLOGO</p><p className="mt-1 text-sm text-zinc-300">{products.length} produto{products.length === 1 ? '' : 's'} ativos no catálogo</p></div>
      {loading ? <div className="px-5 py-14 text-center text-sm text-zinc-500">Carregando catálogo...</div> : products.length === 0 ? <div className="px-5 py-14 text-center"><Package className="mx-auto h-9 w-9 text-zinc-700" /><p className="mt-3 text-sm text-zinc-400">Nenhum produto cadastrado.</p><button type="button" onClick={openCreate} className="mt-4 text-sm font-medium text-emerald-400 hover:text-emerald-300">Criar o primeiro produto</button></div> : <div className="divide-y divide-white/[0.06]">{products.map(product => <article key={product.id} className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-base font-semibold text-white">{product.name}</h3><span className={`rounded-full border px-2 py-0.5 text-[10px] ${product.status === 'active' ? 'border-emerald-400/20 text-emerald-300' : product.status === 'archived' ? 'border-zinc-500/20 text-zinc-500' : 'border-amber-400/20 text-amber-300'}`}>{product.status}</span></div><p className="mt-1 text-xs text-zinc-500">{product.slug} {product.sku ? `• SKU ${product.sku}` : ''}</p></div><div className="flex items-center gap-5"><div className="text-right"><p className="text-sm font-semibold text-zinc-100">{money(Number(product.unit_amount), product.currency)}</p><p className="text-[10px] text-zinc-500">{product.billing_type === 'subscription' ? `recorrente / ${product.billing_interval}` : product.billing_type === 'free' ? 'gratuito' : 'pagamento único'}</p></div><div className="flex gap-1"><button type="button" onClick={() => openEdit(product)} disabled={product.status === 'archived'} className="rounded-lg px-3 py-2 text-xs text-zinc-300 hover:bg-white/[0.04] disabled:opacity-30">Editar</button>{product.status === 'archived' ? <button type="button" onClick={() => void restore(product)} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs text-emerald-300 hover:bg-emerald-400/[0.06]"><RotateCcw className="h-3.5 w-3.5" />Restaurar</button> : <button type="button" onClick={() => void archive(product)} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs text-rose-300 hover:bg-rose-400/[0.06]"><Archive className="h-3.5 w-3.5" />Arquivar</button>}</div></div></article>)}</div>}
    </section>
  </main>
}
