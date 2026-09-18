'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, BarChart3, RefreshCw, TrendingUp, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Transaction = {
  id: string
  amount: number | null
  currency: string | null
  status: string
  funnel_id: string | null
  gateway_id: string | null
  created_at: string
  completed_at: string | null
}

type Checkout = {
  id: string
  status: string
  amount: number | null
  created_at: string
  completed_at: string | null
}

const money = (value: number, currency = 'BRL') =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value)

const pct = (value: number) => `${value.toFixed(1).replace('.', ',')}%`

export default function AnalyticsPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [checkouts, setCheckouts] = useState<Checkout[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<7 | 30 | 90>(30)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const { data: auth } = await db.auth.getUser()
      if (!auth.user) {
        setTransactions([])
        setCheckouts([])
        return
      }

      const since = new Date(Date.now() - period * 86400000).toISOString()
      const [tx, co] = await Promise.all([
        db
          .from('gateway_transactions')
          .select('id,amount,currency,status,funnel_id,gateway_id,created_at,completed_at')
          .eq('user_id', auth.user.id)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(10000),
        db
          .from('checkout_sessions')
          .select('id,status,amount,created_at,completed_at')
          .eq('user_id', auth.user.id)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(10000),
      ])

      if (tx.error) throw tx.error
      if (co.error) throw co.error

      setTransactions((tx.data ?? []) as Transaction[])
      setCheckouts((co.data ?? []) as Checkout[])
    } catch (cause) {
      console.error('[ALTHEA-ANALYTICS]', cause)
      setError('Não foi possível carregar as métricas reais.')
    } finally {
      setLoading(false)
    }
  }, [db, period])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    let cancelled = false
    let channel: ReturnType<typeof db.channel> | null = null

    void db.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return
      channel = db
        .channel(`analytics-${data.user.id}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'gateway_transactions',
          filter: `user_id=eq.${data.user.id}`,
        }, () => void load())
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'checkout_sessions',
          filter: `user_id=eq.${data.user.id}`,
        }, () => void load())
        .subscribe()
    })

    return () => {
      cancelled = true
      if (channel) void db.removeChannel(channel)
    }
  }, [db, load])

  const metrics = useMemo(() => {
    const approved = transactions.filter(transaction => transaction.status === 'approved')
    const pending = transactions.filter(transaction => transaction.status === 'pending')
    const failed = transactions.filter(transaction => transaction.status === 'failed')
    const gross = approved.reduce((sum, transaction) => sum + Number(transaction.amount ?? 0), 0)
    const checkoutCompleted = checkouts.filter(checkout => checkout.status === 'completed' || checkout.completed_at)
    const conversion = checkouts.length ? checkoutCompleted.length / checkouts.length * 100 : 0
    const average = approved.length ? gross / approved.length : 0

    return { approved, pending, failed, gross, conversion, average }
  }, [transactions, checkouts])

  const funnelRows = useMemo(() => {
    const map = new Map<string, { total: number; approved: number; gross: number }>()

    for (const transaction of transactions) {
      const key = transaction.funnel_id || 'sem_funil'
      const row = map.get(key) ?? { total: 0, approved: 0, gross: 0 }
      row.total += 1

      if (transaction.status === 'approved') {
        row.approved += 1
        row.gross += Number(transaction.amount ?? 0)
      }

      map.set(key, row)
    }

    return [...map.entries()]
      .sort((a, b) => b[1].gross - a[1].gross)
      .slice(0, 8)
  }, [transactions])

  return (
    <div className="w-full space-y-5">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Inteligência operacional</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">Analytics</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--althea-muted)]">
            Leia o desempenho real dos checkouts e transações no período selecionado.
          </p>
        </div>

        <div className="flex gap-2">
          <div className="flex rounded-xl border border-white/[.06] bg-[var(--althea-surface)] p-1">
            {([7, 30, 90] as const).map(days => (
              <button
                key={days}
                type="button"
                onClick={() => setPeriod(days)}
                className={`rounded-lg px-3 py-2 text-[10px] font-semibold transition ${period === days ? 'bg-[rgba(29,184,84,.08)] text-[var(--althea-brand)]' : 'text-[var(--althea-muted)] hover:text-white'}`}
              >
                {days} dias
              </button>
            ))}
          </div>

          <button type="button" onClick={() => void load()} disabled={loading} aria-label="Atualizar" className="grid h-10 w-10 place-items-center rounded-xl border border-white/[.06] bg-[var(--althea-surface)] text-[var(--althea-muted)] transition hover:text-white disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </section>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-400/15 bg-red-400/[.05] p-4 text-xs text-red-200">
          <X size={15} className="text-red-300" />
          {error}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Receita aprovada" value={loading ? '—' : money(metrics.gross)} note="Somente transações aprovadas" />
        <Metric label="Transações aprovadas" value={loading ? '—' : String(metrics.approved.length)} note={`De ${transactions.length} transações`} />
        <Metric label="Conversão de checkout" value={loading ? '—' : pct(metrics.conversion)} note="Sessões concluídas / iniciadas" />
        <Metric label="Ticket médio" value={loading ? '—' : money(metrics.average)} note="Por transação aprovada" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,.8fr)]">
        <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Desempenho por funil</h2>
              <p className="mt-1 text-[10px] text-[var(--althea-muted)]">Receita e aprovação no período selecionado.</p>
            </div>
            <BarChart3 size={17} className="text-[var(--althea-brand)]" />
          </div>

          {funnelRows.length === 0 ? (
            <div className="mt-4 grid min-h-[240px] place-items-center rounded-xl border border-dashed border-white/[.06] bg-[var(--althea-bg)] text-center">
              <div className="max-w-sm px-5">
                <Activity size={24} className="mx-auto text-[var(--althea-brand)] opacity-60" />
                <p className="mt-3 text-sm font-medium text-white">Nenhum dado no período</p>
                <p className="mt-1 text-[10px] leading-4 text-[var(--althea-muted)]">As métricas serão preenchidas quando eventos reais chegarem.</p>
              </div>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {funnelRows.map(([id, row]) => {
                const approval = row.total ? Math.min(100, row.approved / row.total * 100) : 0
                return (
                  <div key={id} className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate font-mono text-[9px] text-[var(--althea-muted)]">{id}</span>
                      <strong className="text-[10px] font-semibold text-white">{money(row.gross)}</strong>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[.04]">
                      <div className="h-full rounded-full bg-[var(--althea-brand)]" style={{ width: `${approval}%` }} />
                    </div>
                    <div className="mt-2 flex justify-between text-[8px] text-[var(--althea-muted)]">
                      <span>{row.approved}/{row.total} aprovadas</span>
                      <span>{row.total ? pct(approval) : '0,0%'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </article>

        <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Estado operacional</h2>
              <p className="mt-1 text-[10px] text-[var(--althea-muted)]">Distribuição das transações carregadas.</p>
            </div>
            <TrendingUp size={17} className="text-[var(--althea-brand)]" />
          </div>

          <div className="mt-5 space-y-2">
            <StateRow label="Aprovadas" value={metrics.approved.length} tone="brand" />
            <StateRow label="Pendentes" value={metrics.pending.length} tone="warning" />
            <StateRow label="Falhas" value={metrics.failed.length} tone="danger" />
          </div>
        </article>
      </section>
    </div>
  )
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <article className="min-h-[128px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
      <span className="text-[10px] text-[var(--althea-muted)]">{label}</span>
      <strong className="mt-4 block text-[24px] font-semibold tracking-[-.035em] text-white">{value}</strong>
      <small className="mt-2 block text-[8px] text-[#617068]">{note}</small>
    </article>
  )
}

function StateRow({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'brand' | 'warning' | 'danger'
}) {
  const valueClass = tone === 'brand'
    ? 'text-[var(--althea-brand)]'
    : tone === 'warning'
      ? 'text-[#D4AF37]'
      : 'text-red-300'

  return (
    <div className="flex items-center justify-between rounded-xl border border-white/[.045] bg-[var(--althea-bg)] px-4 py-3">
      <span className="text-[10px] text-[var(--althea-muted)]">{label}</span>
      <b className={`text-xs font-semibold ${valueClass}`}>{value}</b>
    </div>
  )
}
