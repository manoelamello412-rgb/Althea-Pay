'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

 type CheckoutContext = {
  funnel: { id: string; name: string }
  offer: { id: string; name: string; price: number | string; currency: string; product_id: string; type: string }
  product: { id: string; name: string; description: string | null; product_type: string | null; billing_type: string; billing_interval: string | null; interval_count: number | null; unit_amount: number | string; currency: string }
}

function formatMoney(value: number | string, currency: string) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(amount)
}

export default function PublicCheckoutPage() {
  const params = useParams<{ funnelId: string }>()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const funnelId = typeof params.funnelId === 'string' ? params.funnelId : ''
  const offerId = searchParams.get('offer')
  const [context, setContext] = useState<CheckoutContext | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const [idempotencyKey] = useState(() => `checkout-${crypto.randomUUID()}`)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError('')
      if (!funnelId) { setError('Checkout inválido.'); setLoading(false); return }
      const { data, error: rpcError } = await supabase.rpc('get_public_checkout_context', { p_funnel_id: funnelId, p_offer_id: offerId || null })
      if (!active) return
      if (rpcError) setError('Este checkout não está disponível no momento.')
      else setContext(data as CheckoutContext)
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [funnelId, offerId, supabase])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess(false)
    if (!context) return
    const normalizedName = name.trim()
    const normalizedEmail = email.trim().toLowerCase()
    if (normalizedName.length < 2 || normalizedName.length > 160) { setError('Informe seu nome completo.'); return }
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) { setError('Informe um e-mail válido.'); return }
    if (phone.trim().length > 40) { setError('Telefone inválido.'); return }

    setSubmitting(true)
    try {
      const attribution = Object.fromEntries(['utm_source','utm_medium','utm_campaign','utm_content','utm_term','click_id'].flatMap((key) => { const value = searchParams.get(key); return value ? [[key, value]] : [] }))
      const { data, error: rpcError } = await supabase.rpc('create_public_checkout_session', {
        p_funnel_id: context.funnel.id,
        p_offer_id: context.offer.id,
        p_customer: { name: normalizedName, email: normalizedEmail, phone: phone.trim() },
        p_attribution: attribution,
        p_metadata: { source: 'public_checkout' },
        p_idempotency_key: idempotencyKey,
      })
      if (rpcError) throw rpcError
      if (!data?.ok || !data?.session?.id) throw new Error('CHECKOUT_CREATE_FAILED')
      setSuccess(true)
    } catch {
      setError('Não foi possível iniciar o checkout. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <main className="min-h-screen bg-[#070b09] px-5 py-10 text-white"><div className="mx-auto max-w-xl animate-pulse rounded-3xl border border-white/10 bg-white/[0.03] p-8"><div className="h-7 w-2/3 rounded bg-white/10"/><div className="mt-4 h-4 w-full rounded bg-white/10"/><div className="mt-8 h-12 w-full rounded bg-white/10"/></div></main>
  if (error && !context) return <main className="min-h-screen bg-[#070b09] px-5 py-10 text-white"><div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center"><h1 className="text-xl font-semibold">Checkout indisponível</h1><p className="mt-2 text-sm text-white/60">{error}</p></div></main>
  if (!context) return null

  return (
    <main className="min-h-screen bg-[#070b09] px-4 py-8 text-white sm:px-6 sm:py-12">
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_420px]">
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">{context.funnel.name}</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{context.product.name}</h1>
          {context.product.description && <p className="mt-3 text-sm leading-6 text-white/60">{context.product.description}</p>}
          <div className="mt-8 rounded-2xl border border-white/10 bg-black/10 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-white/40">Oferta</p>
            <div className="mt-2 flex items-end justify-between gap-4"><h2 className="font-medium">{context.offer.name}</h2><strong className="text-xl">{formatMoney(context.offer.price, context.offer.currency)}</strong></div>
            {context.product.billing_type === 'subscription' && <p className="mt-2 text-xs text-white/45">Cobrança recorrente: {context.product.interval_count || 1} {context.product.billing_interval || 'período(s)'}</p>}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.045] p-6 shadow-2xl sm:p-7">
          {success ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center text-center"><div className="flex h-14 w-14 items-center justify-center rounded-full border border-emerald-400/20 bg-emerald-400/10 text-emerald-300 text-2xl">✓</div><h2 className="mt-5 text-xl font-semibold">Checkout iniciado</h2><p className="mt-2 text-sm leading-6 text-white/55">Seus dados foram registrados. A próxima etapa de pagamento será conectada ao orquestrador.</p></div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div><h2 className="text-lg font-semibold">Seus dados</h2><p className="mt-1 text-xs text-white/45">Preencha os dados para continuar.</p></div>
              {error && <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">{error}</div>}
              <label className="block text-sm text-white/70">Nome<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-white outline-none focus:border-white/25"/></label>
              <label className="block text-sm text-white/70">E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-white outline-none focus:border-white/25"/></label>
              <label className="block text-sm text-white/70">Telefone<input value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-white outline-none focus:border-white/25"/></label>
              <button type="submit" disabled={submitting} className="mt-2 h-12 w-full rounded-xl bg-white px-4 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50">{submitting ? 'Iniciando checkout…' : 'Continuar'}</button>
              <p className="text-center text-[11px] leading-5 text-white/35">Seus dados são enviados diretamente para o checkout desta oferta. Nenhum gateway de pagamento é fixado nesta etapa.</p>
            </form>
          )}
        </section>
      </div>
    </main>
  )
}
