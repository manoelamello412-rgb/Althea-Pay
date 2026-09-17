'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { FunnelWhiteLabelChat } from '@/components/funnel-white-label-chat'

type CheckoutContext = {
  funnel: { id: string; name: string }
  offer: { id: string; name: string; price: number | string; currency: string; product_id: string; type: string }
  product: { id: string; name: string; description: string | null; product_type: string | null; billing_type: string; billing_interval: string | null; interval_count: number | null; unit_amount: number | string; currency: string }
}
type PaymentAction = { type: string; qr_code: string | null; copy_paste: string | null; url: string | null; expires_at: string | null; payment_method: string }
type PaymentResult = { status: string; transactionId: string; checkoutSessionId: string; action: PaymentAction | null }
const terminalStatuses = new Set(['approved', 'failed', 'refunded', 'chargeback'])
function money(value: number | string, currency: string) { const amount = Number(value); return Number.isFinite(amount) ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(amount) : '—' }

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
  const [paymentMethod, setPaymentMethod] = useState('pix')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<PaymentResult | null>(null)
  const [error, setError] = useState('')
  const [idempotencyKey] = useState(() => `checkout-${crypto.randomUUID()}`)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError('')
      if (!funnelId) { setError('Checkout inválido.'); setLoading(false); return }
      const { data, error: checkoutError } = await supabase.rpc('get_public_checkout_context', { p_funnel_id: funnelId, p_offer_id: offerId || null })
      if (!active) return
      if (checkoutError) setError('Este checkout não está disponível no momento.')
      else setContext(data as CheckoutContext)
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [funnelId, offerId, supabase])

  useEffect(() => {
    if (!result?.transactionId || terminalStatuses.has(result.status)) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | null = null

    async function refresh() {
      if (!active || !result) return
      const response = await fetch('/api/payments/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          transaction_id: result.transactionId,
          checkout_session_id: result.checkoutSessionId,
          idempotency_key: idempotencyKey,
        }),
        cache: 'no-store',
      }).catch(() => null)
      const data = await response?.json().catch(() => null)
      if (!active) return
      if (data?.ok) {
        const nextStatus = String(data.status || result.status).toLowerCase()
        setResult(current => current ? { ...current, status: nextStatus, action: data.action ?? current.action } : current)
        if (!terminalStatuses.has(nextStatus)) timer = setTimeout(refresh, 2500)
      } else {
        timer = setTimeout(refresh, 2500)
      }
    }

    void refresh()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [idempotencyKey, result?.checkoutSessionId, result?.status, result?.transactionId])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setResult(null)
    if (!context) return
    const customerName = name.trim()
    const customerEmail = email.trim().toLowerCase()
    const customerPhone = phone.trim()
    if (customerName.length < 2 || customerName.length > 160) { setError('Informe seu nome completo.'); return }
    if (!/^\S+@\S+\.\S+$/.test(customerEmail) || customerEmail.length > 320) { setError('Informe um e-mail válido.'); return }
    if (customerPhone.length > 40) { setError('Telefone inválido.'); return }
    if (!['pix', 'card', 'boleto', 'wallet', 'bank_transfer', 'other'].includes(paymentMethod)) { setError('Forma de pagamento inválida.'); return }

    setSubmitting(true)
    try {
      const attribution = Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'click_id'].flatMap(key => {
        const value = searchParams.get(key)
        return value ? [[key, value]] : []
      }))
      const { data, error: sessionError } = await supabase.rpc('create_public_checkout_session', {
        p_funnel_id: context.funnel.id,
        p_offer_id: context.offer.id,
        p_customer: { name: customerName, email: customerEmail, phone: customerPhone },
        p_attribution: attribution,
        p_metadata: { source: 'public_checkout' },
        p_idempotency_key: idempotencyKey,
      })
      if (sessionError || !data?.ok || !data?.session?.id) throw new Error('CHECKOUT_CREATE_FAILED')

      const paymentResponse = await fetch('/api/payments/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ checkout_session_id: data.session.id, payment_method: paymentMethod, idempotency_key: idempotencyKey }),
      })
      const paymentData = await paymentResponse.json().catch(() => null)
      if (!paymentResponse.ok && !paymentData?.transaction?.id) throw new Error(paymentData?.code || 'PAYMENT_CREATE_FAILED')
      if (!paymentData?.transaction?.id) throw new Error('PAYMENT_CREATE_FAILED')
      const status = String(paymentData.transaction.status || '').toLowerCase()
      if (status === 'failed') throw new Error('PAYMENT_DECLINED')
      setResult({
        status,
        transactionId: paymentData.transaction.id,
        checkoutSessionId: data.session.id,
        action: paymentData.action || null,
      })
    } catch (cause) {
      console.error('[ALTHEA-CHECKOUT-PAYMENT]', cause)
      setError(cause instanceof Error && cause.message === 'PAYMENT_DECLINED'
        ? 'O pagamento foi recusado pelo gateway. Tente outra forma de pagamento.'
        : 'Não foi possível concluir a tentativa de pagamento. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <main className="min-h-screen bg-[#070b09] px-5 py-10 text-white"><div className="mx-auto max-w-xl animate-pulse rounded-3xl border border-white/10 bg-white/[0.03] p-8"><div className="h-7 w-2/3 rounded bg-white/10"/><div className="mt-4 h-4 w-full rounded bg-white/10"/><div className="mt-8 h-12 w-full rounded bg-white/10"/></div></main>
  if (error && !context) return <main className="min-h-screen bg-[#070b09] px-5 py-10 text-white"><div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center"><h1 className="text-xl font-semibold">Checkout indisponível</h1><p className="mt-2 text-sm text-white/60">{error}</p></div></main>
  if (!context) return null

  const action = result?.action
  const chatCustomer = { name: name.trim() || undefined, email: email.trim() || undefined, phone: phone.trim() || undefined }
  const cart = { items: [{ name: context.offer.name, amount: Number(context.offer.price) || 0 }], total: Number(context.offer.price) || 0 }

  return (
    <main className="min-h-screen bg-[#070b09] px-4 py-8 text-white sm:px-6 sm:py-12">
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_420px]">
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">{context.funnel.name}</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{context.product.name}</h1>
          {context.product.description && <p className="mt-3 text-sm leading-6 text-white/60">{context.product.description}</p>}
          <div className="mt-8 rounded-2xl border border-white/10 bg-black/10 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-white/40">Oferta</p>
            <div className="mt-2 flex items-end justify-between gap-4"><h2 className="font-medium">{context.offer.name}</h2><strong className="text-xl">{money(context.offer.price, context.offer.currency)}</strong></div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.045] p-6 shadow-2xl sm:p-7">
          {result ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/5 text-2xl">{result.status === 'approved' ? '✓' : result.status === 'failed' ? '!' : result.status === 'refunded' ? '↩' : result.status === 'chargeback' ? '!' : '…'}</div>
              <h2 className="mt-5 text-xl font-semibold">{result.status === 'approved' ? 'Pagamento aprovado' : result.status === 'failed' ? 'Pagamento não aprovado' : result.status === 'refunded' ? 'Pagamento estornado' : result.status === 'chargeback' ? 'Pagamento em contestação' : 'Pagamento em processamento'}</h2>
              {action?.type === 'pix' && (action.qr_code || action.copy_paste) && (
                <div className="mt-6 w-full rounded-2xl border border-white/10 bg-black/20 p-4 text-left">
                  <p className="text-xs font-semibold uppercase tracking-wider text-white/50">PIX</p>
                  {action.qr_code && /^data:image\//i.test(action.qr_code) && <img src={action.qr_code} alt="QR Code PIX" className="mx-auto mt-4 h-48 w-48 rounded-xl bg-white p-2"/>}
                  {action.copy_paste && <><p className="mt-4 text-xs text-white/45">Código copia e cola</p><div className="mt-2 break-all rounded-xl bg-black/30 p-3 text-[11px] text-white/70">{action.copy_paste}</div><button type="button" onClick={() => void navigator.clipboard?.writeText(action.copy_paste || '')} className="mt-3 h-10 w-full rounded-xl bg-white text-xs font-semibold text-black">Copiar código PIX</button></>}
                </div>
              )}
              {action?.type === 'redirect' && action.url && <a href={action.url} target="_blank" rel="noreferrer" className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-white px-5 text-sm font-semibold text-black">Continuar para pagamento</a>}
              <p className="mt-4 text-sm leading-6 text-white/55">{result.status === 'approved' ? 'O gateway confirmou a transação.' : result.status === 'failed' ? 'A transação não foi aprovada.' : action ? 'A instrução de pagamento foi recebida do gateway. O status continua sendo acompanhado automaticamente.' : 'A transação foi encaminhada ao gateway e aguarda confirmação.'}</p>
              <p className="mt-4 break-all text-[11px] text-white/30">Transação: {result.transactionId}</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div><h2 className="text-lg font-semibold">Seus dados</h2><p className="mt-1 text-xs text-white/45">Preencha os dados para continuar. Se precisar, o suporte fica disponível durante todo o checkout.</p></div>
              {error && <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">{error}</div>}
              <label className="block text-sm text-white/70">Nome<input value={name} onChange={event => setName(event.target.value)} autoComplete="name" required className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-white outline-none"/></label>
              <label className="block text-sm text-white/70">E-mail<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-white outline-none"/></label>
              <label className="block text-sm text-white/70">Telefone<input value={phone} onChange={event => setPhone(event.target.value)} autoComplete="tel" inputMode="tel" className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-white outline-none"/></label>
              <fieldset><legend className="text-sm text-white/70">Forma de pagamento</legend><div className="mt-2 grid grid-cols-2 gap-2">{[['pix','PIX'],['card','Cartão'],['boleto','Boleto'],['wallet','Carteira'],['bank_transfer','Transferência'],['other','Outra']].map(([value, label]) => <button key={value} type="button" onClick={() => setPaymentMethod(value)} className={`rounded-xl border px-3 py-2.5 text-xs ${paymentMethod === value ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-white/10 text-white/50'}`}>{label}</button>)}</div></fieldset>
              <button type="submit" disabled={submitting} className="mt-2 h-12 w-full rounded-xl bg-white px-4 text-sm font-semibold text-black disabled:opacity-50">{submitting ? 'Processando pagamento…' : 'Continuar para pagamento'}</button>
            </form>
          )}
        </section>
      </div>

      <FunnelWhiteLabelChat
        funnelId={context.funnel.id}
        productName={context.product.name}
        brandName={`Suporte ${context.funnel.name}`}
        customer={chatCustomer}
        cart={cart}
      />
    </main>
  )
}
