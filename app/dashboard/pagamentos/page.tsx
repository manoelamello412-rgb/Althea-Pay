'use client'

import { AlertTriangle, CheckCircle2, Clock3, CreditCard, RefreshCw, Search, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type PaymentStatus = 'created' | 'pending' | 'approved' | 'failed' | 'refunded' | 'chargeback'

type Payment = {
  id: string
  user_id: string
  funnel_id: string | null
  product_id: string | null
  gateway_id: string | null
  external_id: string | null
  amount: number
  currency: string
  status: PaymentStatus
  customer: Record<string, unknown>
  error_message: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

const statusLabel: Record<PaymentStatus, string> = {
  created: 'Criada',
  pending: 'Pendente',
  approved: 'Aprovada',
  failed: 'Falhou',
  refunded: 'Reembolsada',
  chargeback: 'Chargeback',
}

const statusClass: Record<PaymentStatus, string> = {
  created: 'border-white/[.06] bg-white/[.025] text-[var(--althea-muted)]',
  pending: 'border-[rgba(212,175,55,.18)] bg-[rgba(212,175,55,.07)] text-[#D4AF37]',
  approved: 'border-[rgba(29,184,84,.18)] bg-[rgba(29,184,84,.08)] text-[#7bdc9b]',
  failed: 'border-red-400/15 bg-red-400/[.06] text-red-300',
  refunded: 'border-sky-400/15 bg-sky-400/[.06] text-sky-300',
  chargeback: 'border-fuchsia-400/15 bg-fuchsia-400/[.06] text-fuchsia-300',
}

const iconFor = (status: PaymentStatus) =>
  status === 'approved'
    ? CheckCircle2
    : status === 'pending' || status === 'created'
      ? Clock3
      : status === 'failed'
        ? XCircle
        : AlertTriangle

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(Number(amount) || 0)

const dateTime = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))

const customerText = (customer: Record<string, unknown>) =>
  String(customer.name || customer.full_name || customer.email || customer.phone || 'Cliente não identificado')

export default function PagamentosPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [payments, setPayments] = useState<Payment[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | PaymentStatus>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Payment | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const { data: auth } = await db.auth.getUser()
      if (!auth.user) {
        setPayments([])
        return
      }

      const result = await db
        .from('gateway_transactions')
        .select('id,user_id,funnel_id,product_id,gateway_id,external_id,amount,currency,status,customer,error_message,created_at,updated_at,completed_at')
        .order('created_at', { ascending: false })
        .limit(5000)

      if (result.error) throw result.error
      setPayments((result.data || []) as Payment[])
    } catch (cause) {
      console.error('[ALTHEA-PAGAMENTOS]', cause)
      setError('Não foi possível carregar os pagamentos reais.')
    } finally {
      setLoading(false)
    }
  }, [db])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    let channel: ReturnType<typeof db.channel> | null = null
    let cancelled = false

    const subscribe = async () => {
      const { data: auth } = await db.auth.getUser()
      if (cancelled || !auth.user) return

      channel = db
        .channel(`payments-${auth.user.id}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'gateway_transactions',
        }, () => void load())
        .subscribe()
    }

    void subscribe()
    return () => {
      cancelled = true
      if (channel) void db.removeChannel(channel)
    }
  }, [db, load])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return payments.filter((payment) => {
      if (status !== 'all' && payment.status !== status) return false
      if (!needle) return true

      return [
        payment.id,
        payment.external_id,
        payment.gateway_id,
        payment.funnel_id,
        payment.product_id,
        customerText(payment.customer),
      ].filter(Boolean).join(' ').toLowerCase().includes(needle)
    })
  }, [payments, query, status])

  const metrics = useMemo(() => ({
    total: payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    approved: payments.filter((payment) => payment.status === 'approved').length,
    pending: payments.filter((payment) => payment.status === 'pending').length,
    exceptions: payments.filter((payment) => ['failed', 'chargeback'].includes(payment.status)).length,
  }), [payments])

  return (
    <div className="w-full space-y-5">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Operação financeira</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">Pagamentos</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--althea-muted)]">
            Acompanhe as transações processadas pelos gateways externos, seus estados e as exceções reportadas.
          </p>
        </div>

        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center gap-2 self-start rounded-xl border border-white/[.06] bg-[var(--althea-surface)] px-4 text-[10px] font-semibold text-[var(--althea-muted)] transition hover:text-white disabled:opacity-50 lg:self-auto">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Volume registrado" value={money(metrics.total, 'BRL')} />
        <Metric label="Aprovados" value={String(metrics.approved)} />
        <Metric label="Pendentes" value={String(metrics.pending)} />
        <Metric label="Exceções" value={String(metrics.exceptions)} warning={metrics.exceptions > 0} />
      </section>

      <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3 lg:max-w-xl">
            <Search size={14} className="text-[var(--althea-muted)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar cliente, transação, gateway ou funil..."
              className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-[#56645d]"
            />
          </label>

          <div className="flex gap-1 overflow-x-auto pb-1">
            {(['all', 'approved', 'pending', 'failed', 'refunded', 'chargeback'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setStatus(item)}
                className={`whitespace-nowrap rounded-xl border px-3 py-2 text-[10px] font-semibold transition ${status === item ? 'border-[rgba(29,184,84,.18)] bg-[rgba(29,184,84,.07)] text-[var(--althea-brand)]' : 'border-white/[.05] text-[var(--althea-muted)] hover:text-white'}`}
              >
                {item === 'all' ? 'Todos' : statusLabel[item]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map(item => <div key={item} className="h-16 animate-pulse rounded-xl bg-[var(--althea-bg)]" />)}
            </div>
          ) : error ? (
            <div className="grid min-h-[240px] place-items-center text-center">
              <div>
                <XCircle className="mx-auto text-red-300" size={22} />
                <p className="mt-3 text-sm font-medium text-white">Falha na sincronização</p>
                <p className="mt-1 text-[10px] text-[var(--althea-muted)]">{error}</p>
                <button type="button" onClick={() => void load()} className="mt-4 rounded-xl border border-white/[.06] px-3 py-2 text-[10px] text-[var(--althea-muted)] hover:text-white">
                  Tentar novamente
                </button>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="grid min-h-[240px] place-items-center rounded-xl border border-dashed border-white/[.06] bg-[var(--althea-bg)] text-center">
              <div className="max-w-sm px-5">
                <CreditCard className="mx-auto text-[var(--althea-brand)] opacity-60" size={24} />
                <p className="mt-3 text-sm font-medium text-white">Nenhum pagamento encontrado</p>
                <p className="mt-1 text-[10px] leading-4 text-[var(--althea-muted)]">Os dados aparecerão aqui quando transações reais forem recebidas ou quando os filtros encontrarem resultados.</p>
              </div>
            </div>
          ) : (
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/[.05] text-[9px] text-[var(--althea-muted)]">
                  <th className="pb-3 pr-4 font-medium">Cliente</th>
                  <th className="pb-3 pr-4 font-medium">Valor</th>
                  <th className="pb-3 pr-4 font-medium">Gateway</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 pr-4 font-medium">Atualizado</th>
                  <th className="pb-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((payment) => {
                  const Icon = iconFor(payment.status)
                  return (
                    <tr key={payment.id} className="border-b border-white/[.035] last:border-0">
                      <td className="py-3.5 pr-4">
                        <button type="button" onClick={() => setSelected(payment)} className="text-left">
                          <strong className="block text-[10px] font-semibold text-white">{customerText(payment.customer)}</strong>
                          <span className="mt-1 block max-w-[280px] truncate text-[8px] text-[var(--althea-muted)]">{payment.external_id || payment.id}</span>
                        </button>
                      </td>
                      <td className="py-3.5 pr-4 text-[10px] font-semibold text-white">{money(Number(payment.amount), payment.currency)}</td>
                      <td className="py-3.5 pr-4 text-[10px] text-[var(--althea-muted)]">{payment.gateway_id || 'Não informado'}</td>
                      <td className="py-3.5 pr-4">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[8px] font-semibold ${statusClass[payment.status]}`}>
                          <Icon size={11} />
                          {statusLabel[payment.status]}
                        </span>
                      </td>
                      <td className="py-3.5 pr-4 text-[9px] text-[var(--althea-muted)]">{dateTime(payment.updated_at || payment.created_at)}</td>
                      <td className="py-3.5 text-right">
                        <button type="button" onClick={() => setSelected(payment)} className="rounded-lg border border-white/[.05] px-2.5 py-2 text-[9px] text-[var(--althea-muted)] hover:bg-white/[.025] hover:text-white">
                          Detalhes
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {selected && (
        <div
          className="fixed inset-0 z-[140] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm md:items-center md:p-6"
          role="dialog"
          aria-modal="true"
          onClick={(event) => { if (event.currentTarget === event.target) setSelected(null) }}
        >
          <section className="w-full max-w-2xl rounded-t-3xl border border-white/[.07] bg-[var(--althea-surface)] p-6 shadow-2xl md:rounded-3xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[.18em] text-[var(--althea-brand)]">Transação</p>
                <h2 className="mt-1 text-xl font-semibold text-white">{customerText(selected.customer)}</h2>
              </div>
              <button type="button" aria-label="Fechar" onClick={() => setSelected(null)} className="grid h-9 w-9 place-items-center rounded-lg text-[var(--althea-muted)] hover:bg-white/[.03] hover:text-white">
                <XCircle size={17} />
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                ['Status', statusLabel[selected.status]],
                ['Valor', money(Number(selected.amount), selected.currency)],
                ['Gateway', selected.gateway_id || 'Não informado'],
                ['Criada em', dateTime(selected.created_at)],
                ['ID interno', selected.id],
              ].map(([label, value], index) => (
                <div key={label} className={`rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-4 ${index === 4 ? 'sm:col-span-2' : ''}`}>
                  <span className="text-[9px] text-[var(--althea-muted)]">{label}</span>
                  <strong className="mt-2 block break-all text-xs font-medium text-white">{value}</strong>
                </div>
              ))}

              {selected.error_message && (
                <div className="rounded-xl border border-red-400/12 bg-red-400/[.04] p-4 sm:col-span-2">
                  <span className="text-[9px] text-red-300/70">Falha reportada</span>
                  <p className="mt-2 text-xs text-red-200">{selected.error_message}</p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <article className="min-h-[112px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
      <p className="text-[10px] text-[var(--althea-muted)]">{label}</p>
      <strong className={`mt-4 block text-[24px] font-semibold tracking-[-.035em] ${warning ? 'text-[#D4AF37]' : 'text-white'}`}>{value}</strong>
    </article>
  )
}
