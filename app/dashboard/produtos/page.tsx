'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  Check,
  Package,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  X,
} from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Product = {
  id: string
  name: string
  slug: string
  description: string | null
  product_type: string | null
  status: 'draft' | 'active' | 'paused' | 'archived'
  billing_type: 'one_time' | 'subscription' | 'free'
  billing_interval: string | null
  interval_count: number | null
  unit_amount: number
  currency: string
  sku: string | null
  metadata: Record<string, unknown>
  version: number
  created_at: string
  updated_at: string
}

type FormState = {
  name: string
  slug: string
  description: string
  product_type: string
  billing_type: 'one_time' | 'subscription' | 'free'
  unit_amount: string
  currency: string
  billing_interval: string
  interval_count: string
  sku: string
}

const emptyForm: FormState = {
  name: '',
  slug: '',
  description: '',
  product_type: 'digital',
  billing_type: 'one_time',
  unit_amount: '0',
  currency: 'BRL',
  billing_interval: 'month',
  interval_count: '1',
  sku: '',
}

const money = (value: number, currency: string) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency, minimumFractionDigits: 2 }).format(value)

const statusLabel: Record<Product['status'], string> = {
  active: 'Ativo',
  draft: 'Rascunho',
  paused: 'Pausado',
  archived: 'Arquivado',
}

const statusTone: Record<Product['status'], string> = {
  active: 'border-[rgba(29,184,84,.18)] bg-[rgba(29,184,84,.08)] text-[#7bdc9b]',
  draft: 'border-white/[.07] bg-white/[.025] text-[var(--althea-muted)]',
  paused: 'border-[rgba(212,175,55,.18)] bg-[rgba(212,175,55,.07)] text-[#D4AF37]',
  archived: 'border-white/[.05] bg-black/20 text-[#6f7d76]',
}

export default function ProductsPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [products, setProducts] = useState<Product[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editing, setEditing] = useState<Product | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | Product['status']>('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [statusSaving, setStatusSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data: auth } = await db.auth.getUser()
    if (!auth.user) {
      setProducts([])
      setLoading(false)
      return
    }

    const { data, error: queryError } = await db
      .from('products')
      .select('id,name,slug,description,product_type,status,billing_type,billing_interval,interval_count,unit_amount,currency,sku,metadata,version,created_at,updated_at')
      .order('created_at', { ascending: false })

    if (queryError) setError(queryError.message)
    else setProducts((data ?? []) as Product[])

    setLoading(false)
  }, [db])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const channel = db
      .channel('products-workspace')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => { void load() })
      .subscribe()

    return () => { void db.removeChannel(channel) }
  }, [db, load])

  const counts = useMemo(() => ({
    total: products.length,
    active: products.filter(product => product.status === 'active').length,
    draft: products.filter(product => product.status === 'draft').length,
    recurring: products.filter(product => product.billing_type === 'subscription' && product.status !== 'archived').length,
  }), [products])

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return products.filter(product => {
      if (filter !== 'all' && product.status !== filter) return false
      if (!normalized) return true
      return [
        product.name,
        product.slug,
        product.sku,
        product.product_type,
        product.billing_type,
      ].filter(Boolean).join(' ').toLowerCase().includes(normalized)
    })
  }, [filter, products, query])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setError('')
    setNotice('')
    setShowForm(true)
  }

  const openEdit = (product: Product) => {
    setEditing(product)
    setForm({
      name: product.name,
      slug: product.slug,
      description: product.description ?? '',
      product_type: product.product_type ?? 'digital',
      billing_type: product.billing_type,
      unit_amount: String(product.unit_amount ?? 0),
      currency: product.currency,
      billing_interval: product.billing_interval ?? 'month',
      interval_count: String(product.interval_count ?? 1),
      sku: product.sku ?? '',
    })
    setError('')
    setNotice('')
    setShowForm(true)
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return

    setSaving(true)
    setError('')
    setNotice('')

    const amount = Number(form.unit_amount.replace(',', '.'))
    if (!form.name.trim() || !Number.isFinite(amount) || amount < 0 || !/^[A-Z]{3}$/.test(form.currency)) {
      setError('Revise nome, preço e moeda antes de salvar.')
      setSaving(false)
      return
    }

    const common = {
      p_name: form.name.trim(),
      p_slug: form.slug.trim() || null,
      p_description: form.description.trim() || null,
      p_product_type: form.product_type,
      p_billing_type: form.billing_type,
      p_unit_amount: amount,
      p_currency: form.currency,
      p_billing_interval: form.billing_type === 'subscription' ? form.billing_interval : null,
      p_interval_count: form.billing_type === 'subscription' ? Number(form.interval_count || 1) : null,
      p_sku: form.sku.trim() || null,
      p_metadata: {},
    }

    const result = editing
      ? await db.rpc('update_product', { p_product_id: editing.id, p_version: editing.version, ...common, p_status: editing.status })
      : await db.rpc('create_product', common)

    if (result.error) {
      setError(result.error.message)
    } else {
      setNotice(editing ? 'Produto atualizado.' : 'Produto criado em rascunho.')
      setShowForm(false)
      setEditing(null)
      setForm(emptyForm)
      await load()
    }

    setSaving(false)
  }

  const setStatus = async (product: Product, status: 'draft' | 'active' | 'paused') => {
    if (statusSaving) return
    setStatusSaving(product.id)
    setError('')
    setNotice('')

    const { error: rpcError } = await db.rpc('set_product_status', {
      p_product_id: product.id,
      p_version: product.version,
      p_status: status,
    })

    if (rpcError) setError(rpcError.message)
    else {
      setNotice(`Produto ${status === 'active' ? 'ativado' : status === 'paused' ? 'pausado' : 'retornado para rascunho'}.`)
      await load()
    }

    setStatusSaving(null)
  }

  const archive = async (product: Product) => {
    if (!window.confirm(`Arquivar o produto “${product.name}”?`)) return

    setError('')
    setNotice('')
    const { error: rpcError } = await db.rpc('archive_product', {
      p_product_id: product.id,
      p_version: product.version,
    })

    if (rpcError) setError(rpcError.message)
    else {
      setNotice('Produto arquivado.')
      await load()
    }
  }

  const restore = async (product: Product) => {
    setError('')
    setNotice('')
    const { error: rpcError } = await db.rpc('restore_product', {
      p_product_id: product.id,
      p_version: product.version,
    })

    if (rpcError) setError(rpcError.message)
    else {
      setNotice('Produto restaurado como rascunho.')
      await load()
    }
  }

  return (
    <div className="w-full space-y-5">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Catálogo</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">Produtos</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--althea-muted)]">
            Crie e gerencie os produtos reais da operação. O catálogo fica independente dos gateways e pode ser ligado aos funis quando você decidir.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[.06] bg-[var(--althea-surface)] px-3 text-[10px] font-semibold text-[var(--althea-muted)] transition hover:text-white disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
          <button type="button" onClick={openCreate} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--althea-brand)] px-4 text-[10px] font-bold text-[#06110a] shadow-[0_8px_28px_rgba(29,184,84,.14)] transition hover:brightness-110">
            <Plus size={14} />
            Novo produto
          </button>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-red-400/15 bg-red-400/[.05] px-4 py-3 text-xs text-red-200">
          {error}
        </div>
      )}

      {notice && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-[rgba(29,184,84,.16)] bg-[rgba(29,184,84,.055)] px-4 py-3 text-xs text-[#8edca5]">
          <Check size={14} />
          {notice}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Produtos', counts.total],
          ['Ativos', counts.active],
          ['Rascunhos', counts.draft],
          ['Recorrentes', counts.recurring],
        ].map(([label, value]) => (
          <article key={String(label)} className="min-h-[112px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
            <p className="text-[10px] text-[var(--althea-muted)]">{label}</p>
            <strong className="mt-4 block text-[24px] font-semibold tracking-[-.035em] text-white">{value}</strong>
          </article>
        ))}
      </section>

      {showForm && (
        <section className="rounded-2xl border border-[rgba(29,184,84,.12)] bg-[var(--althea-surface)] p-5 sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-4 border-b border-white/[.05] pb-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-[var(--althea-brand)]">{editing ? 'Edição' : 'Cadastro'}</p>
              <h2 className="mt-1 text-lg font-semibold text-white">{editing ? 'Editar produto' : 'Novo produto'}</h2>
              <p className="mt-1 text-[10px] text-[var(--althea-muted)]">As alterações são persistidas no catálogo real da sua conta.</p>
            </div>
            <button type="button" onClick={() => setShowForm(false)} className="grid h-9 w-9 place-items-center rounded-lg text-[var(--althea-muted)] transition hover:bg-white/[.03] hover:text-white" aria-label="Fechar formulário">
              <X size={17} />
            </button>
          </div>

          <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
            <Field label="Nome">
              <input required maxLength={160} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className="althea-ds-input text-sm" />
            </Field>

            <Field label="Slug">
              <input maxLength={80} value={form.slug} onChange={event => setForm({ ...form, slug: event.target.value.toLowerCase().replace(/\s+/g, '-') })} placeholder="gerado automaticamente se vazio" className="althea-ds-input text-sm" />
            </Field>

            <div className="md:col-span-2">
              <Field label="Descrição">
                <textarea maxLength={5000} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} rows={3} className="althea-ds-input min-h-[96px] resize-none py-3 text-sm" />
              </Field>
            </div>

            <Field label="Tipo">
              <select value={form.product_type} onChange={event => setForm({ ...form, product_type: event.target.value })} className="althea-ds-input text-sm">
                <option value="digital">Digital</option>
                <option value="course">Curso</option>
                <option value="membership">Membership</option>
                <option value="subscription">Assinatura</option>
                <option value="service">Serviço</option>
                <option value="physical">Físico</option>
                <option value="other">Outro</option>
              </select>
            </Field>

            <Field label="Cobrança">
              <select value={form.billing_type} onChange={event => setForm({ ...form, billing_type: event.target.value as FormState['billing_type'] })} className="althea-ds-input text-sm">
                <option value="one_time">Pagamento único</option>
                <option value="subscription">Recorrente</option>
                <option value="free">Gratuito</option>
              </select>
            </Field>

            <Field label="Preço">
              <input inputMode="decimal" value={form.unit_amount} onChange={event => setForm({ ...form, unit_amount: event.target.value })} className="althea-ds-input text-sm" />
            </Field>

            <Field label="Moeda">
              <input maxLength={3} value={form.currency} onChange={event => setForm({ ...form, currency: event.target.value.toUpperCase() })} className="althea-ds-input text-sm" />
            </Field>

            {form.billing_type === 'subscription' && (
              <>
                <Field label="Intervalo">
                  <select value={form.billing_interval} onChange={event => setForm({ ...form, billing_interval: event.target.value })} className="althea-ds-input text-sm">
                    <option value="day">Dia</option>
                    <option value="week">Semana</option>
                    <option value="month">Mês</option>
                    <option value="year">Ano</option>
                  </select>
                </Field>
                <Field label="A cada">
                  <input type="number" min={1} value={form.interval_count} onChange={event => setForm({ ...form, interval_count: event.target.value })} className="althea-ds-input text-sm" />
                </Field>
              </>
            )}

            <div className="md:col-span-2">
              <Field label="SKU opcional">
                <input maxLength={120} value={form.sku} onChange={event => setForm({ ...form, sku: event.target.value })} className="althea-ds-input text-sm" />
              </Field>
            </div>

            <div className="flex justify-end gap-2 pt-2 md:col-span-2">
              <button type="button" onClick={() => setShowForm(false)} className="h-10 rounded-xl border border-white/[.06] px-4 text-[10px] font-semibold text-[var(--althea-muted)] transition hover:text-white">
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--althea-brand)] px-5 text-[10px] font-bold text-[#06110a] disabled:cursor-wait disabled:opacity-60">
                <Save size={14} />
                {saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Criar produto'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3 lg:max-w-xl">
            <Search size={14} className="shrink-0 text-[var(--althea-muted)]" />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por nome, slug ou SKU..." className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-[#56645d]" />
          </label>

          <div className="flex gap-1 overflow-x-auto">
            {(['all', 'active', 'draft', 'paused', 'archived'] as const).map(item => (
              <button key={item} type="button" onClick={() => setFilter(item)} className={`whitespace-nowrap rounded-xl border px-3 py-2 text-[10px] font-semibold transition ${filter === item ? 'border-[rgba(29,184,84,.18)] bg-[rgba(29,184,84,.07)] text-[var(--althea-brand)]' : 'border-white/[.05] text-[var(--althea-muted)] hover:text-white'}`}>
                {item === 'all' ? 'Todos' : statusLabel[item]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map(item => <div key={item} className="h-16 animate-pulse rounded-xl bg-[var(--althea-bg)]" />)}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="grid min-h-[260px] place-items-center rounded-xl border border-dashed border-white/[.06] bg-[var(--althea-bg)] text-center">
              <div className="max-w-[290px] px-5">
                <Package size={24} className="mx-auto text-[var(--althea-brand)] opacity-60" />
                <p className="mt-3 text-sm font-medium text-white">{products.length ? 'Nenhum produto encontrado' : 'Seu catálogo ainda está vazio'}</p>
                <p className="mt-1 text-[10px] leading-4 text-[var(--althea-muted)]">
                  {products.length ? 'Ajuste a busca ou os filtros para encontrar outro produto.' : 'Crie o primeiro produto para começar a estruturar ofertas e funis.'}
                </p>
                {!products.length && (
                  <button type="button" onClick={openCreate} className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl border border-[rgba(29,184,84,.16)] bg-[rgba(29,184,84,.055)] px-3 text-[10px] font-semibold text-[var(--althea-brand)]">
                    <Plus size={13} />
                    Criar produto
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-white/[.05] text-[9px] text-[var(--althea-muted)]">
                    <th className="pb-3 pr-4 font-medium">Produto</th>
                    <th className="pb-3 pr-4 font-medium">Tipo</th>
                    <th className="pb-3 pr-4 font-medium">Cobrança</th>
                    <th className="pb-3 pr-4 font-medium">Preço</th>
                    <th className="pb-3 pr-4 font-medium">Status</th>
                    <th className="pb-3 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map(product => (
                    <tr key={product.id} className="border-b border-white/[.035] last:border-0">
                      <td className="py-3.5 pr-4">
                        <p className="max-w-[260px] truncate text-[11px] font-semibold text-white">{product.name}</p>
                        <p className="mt-1 max-w-[260px] truncate text-[9px] text-[var(--althea-muted)]">{product.slug}{product.sku ? ` · SKU ${product.sku}` : ''}</p>
                      </td>
                      <td className="py-3.5 pr-4 text-[10px] text-[var(--althea-muted)]">{product.product_type || '—'}</td>
                      <td className="py-3.5 pr-4 text-[10px] text-[var(--althea-muted)]">
                        {product.billing_type === 'subscription' ? `Recorrente · ${product.billing_interval || 'intervalo'}` : product.billing_type === 'free' ? 'Gratuito' : 'Pagamento único'}
                      </td>
                      <td className="py-3.5 pr-4 text-[10px] font-semibold text-white">{money(Number(product.unit_amount), product.currency)}</td>
                      <td className="py-3.5 pr-4">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-[8px] font-semibold ${statusTone[product.status]}`}>{statusLabel[product.status]}</span>
                      </td>
                      <td className="py-3.5 text-right">
                        <div className="flex justify-end gap-1">
                          {product.status !== 'archived' && (
                            <button type="button" onClick={() => openEdit(product)} disabled={statusSaving === product.id} className="rounded-lg px-2.5 py-2 text-[9px] text-[var(--althea-muted)] hover:bg-white/[.03] hover:text-white disabled:opacity-30">
                              Editar
                            </button>
                          )}
                          {product.status === 'draft' && (
                            <button type="button" onClick={() => void setStatus(product, 'active')} disabled={statusSaving === product.id} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-[9px] text-[#7bdc9b] hover:bg-[rgba(29,184,84,.055)] disabled:opacity-40">
                              <Play size={12} />Ativar
                            </button>
                          )}
                          {product.status === 'active' && (
                            <button type="button" onClick={() => void setStatus(product, 'paused')} disabled={statusSaving === product.id} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-[9px] text-[#D4AF37] hover:bg-[rgba(212,175,55,.055)] disabled:opacity-40">
                              <Pause size={12} />Pausar
                            </button>
                          )}
                          {product.status === 'paused' && (
                            <button type="button" onClick={() => void setStatus(product, 'active')} disabled={statusSaving === product.id} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-[9px] text-[#7bdc9b] hover:bg-[rgba(29,184,84,.055)] disabled:opacity-40">
                              <Play size={12} />Reativar
                            </button>
                          )}
                          {product.status === 'archived' ? (
                            <button type="button" onClick={() => void restore(product)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-[9px] text-[#7bdc9b] hover:bg-[rgba(29,184,84,.055)]">
                              <RotateCcw size={12} />Restaurar
                            </button>
                          ) : (
                            <button type="button" onClick={() => void archive(product)} disabled={statusSaving === product.id} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-[9px] text-red-300 hover:bg-red-400/[.05] disabled:opacity-40">
                              <Archive size={12} />Arquivar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-[10px] font-medium text-[var(--althea-muted)]">
      {label}
      {children}
    </label>
  )
}
