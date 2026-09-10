'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export interface ProductRoiMetric {
  productId: string
  productName: string
  totalInterventions: number
  successfulRecoveries: number
  totalRevenueSavedCents: number
  conversionRatePercent: number
}

export interface GlobalRoiState {
  totalRecoveredRevenueCents: number
  averageRescueTimeSeconds: number | null
  products: ProductRoiMetric[]
  lastRecoveredAt: string | null
  lastRecoveredAmountCents: number | null
}

type JournalRow = {
  event_type: string
  entity_id: string | null
  product_id: string | null
  payload: Record<string, unknown>
  created_at: string
}

type TransactionRow = {
  id: string
  product_id: string | null
  amount: number
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

const WINDOW_MINUTES = 30
const REFRESH_MS = 30_000

function toCents(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100)
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.round(parsed * 100)
  }
  return 0
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isCriticalSignal(payload: Record<string, unknown>): boolean {
  return payload.signal === 'critical_hesitation' || payload.signal === 'exit_intent' || payload.exitIntent === true
}

function interventionTimestamp(payload: Record<string, unknown>, fallback: string): number {
  const value = text(payload.occurredAt) ?? text(payload.timestamp)
  const parsed = value ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : Date.parse(fallback)
}

export const IaraRoiDashboard: React.FC = () => {
  const [roiData, setRoiData] = useState<GlobalRoiState>({
    totalRecoveredRevenueCents: 0,
    averageRescueTimeSeconds: null,
    products: [],
    lastRecoveredAt: null,
    lastRecoveredAmountCents: null,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    const supabase = createSupabaseBrowserClient()
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData.user) {
      setError('Sessão não autenticada.')
      setLoading(false)
      return
    }

    setUserId(authData.user.id)
    const cutoff = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString()

    const [journalResult, transactionResult] = await Promise.all([
      supabase
        .from('iara_memory_journal')
        .select('event_type,entity_id,product_id,payload,created_at')
        .eq('user_id', authData.user.id)
        .in('event_type', ['PREDICTIVE_RESCUE', 'EDGE_BEHAVIOR_TELEMETRY'])
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false }),
      supabase
        .from('gateway_transactions')
        .select('id,product_id,amount,metadata,created_at,updated_at')
        .eq('user_id', authData.user.id)
        .eq('status', 'approved')
        .gte('updated_at', cutoff)
        .order('updated_at', { ascending: false }),
    ])

    if (journalResult.error) throw new Error(journalResult.error.message)
    if (transactionResult.error) throw new Error(transactionResult.error.message)

    const journal = (journalResult.data ?? []) as JournalRow[]
    const transactions = (transactionResult.data ?? []) as TransactionRow[]
    const signals = journal.filter((row) => isCriticalSignal(row.payload))
    const rescues = journal.filter((row) => row.event_type === 'PREDICTIVE_RESCUE')

    const metrics = new Map<string, ProductRoiMetric>()
    const rescueDurations: number[] = []
    const attributedTransactions = new Set<string>()
    let lastRecoveredAt: string | null = null
    let lastRecoveredAmountCents: number | null = null

    for (const transaction of transactions) {
      const transactionProduct = transaction.product_id
      if (!transactionProduct) continue

      const transactionTime = Date.parse(transaction.updated_at)
      if (!Number.isFinite(transactionTime)) continue

      const transactionMetadata = transaction.metadata ?? {}
      const transactionClientId = text(transactionMetadata.clientId) ?? text(transactionMetadata.client_id) ?? text(transactionMetadata.customerId)

      const qualifyingSignal = signals
        .filter((signal) => signal.product_id === transactionProduct)
        .filter((signal) => {
          const signalClientId = text(signal.payload.clientId) ?? text(signal.payload.client_id) ?? text(signal.entity_id)
          if (!signalClientId || !transactionClientId || signalClientId !== transactionClientId) return false
          const signalTime = interventionTimestamp(signal.payload, signal.created_at)
          return signalTime <= transactionTime && transactionTime - signalTime <= WINDOW_MINUTES * 60_000
        })
        .sort((a, b) => interventionTimestamp(b.payload, b.created_at) - interventionTimestamp(a.payload, a.created_at))[0]

      if (!qualifyingSignal) continue

      const rescue = rescues
        .filter((item) => item.product_id === transactionProduct)
        .filter((item) => {
          const rescueClientId = text(item.payload.clientId) ?? text(item.payload.client_id) ?? text(item.entity_id)
          if (!rescueClientId || !transactionClientId || rescueClientId !== transactionClientId) return false
          const rescueTime = interventionTimestamp(item.payload, item.created_at)
          return rescueTime <= transactionTime && transactionTime - rescueTime <= WINDOW_MINUTES * 60_000
        })
        .sort((a, b) => interventionTimestamp(b.payload, b.created_at) - interventionTimestamp(a.payload, a.created_at))[0]

      if (!rescue) continue

      if (attributedTransactions.has(transaction.id)) continue
      attributedTransactions.add(transaction.id)

      const product = metrics.get(transactionProduct) ?? {
        productId: transactionProduct,
        productName: text(transactionMetadata.productName) ?? transactionProduct,
        totalInterventions: 0,
        successfulRecoveries: 0,
        totalRevenueSavedCents: 0,
        conversionRatePercent: 0,
      }

      product.successfulRecoveries += 1
      product.totalRevenueSavedCents += toCents(transaction.amount)
      product.conversionRatePercent = product.totalInterventions > 0
        ? Number(((product.successfulRecoveries / product.totalInterventions) * 100).toFixed(1))
        : 0
      metrics.set(transactionProduct, product)

      const rescueTime = interventionTimestamp(rescue.payload, rescue.created_at)
      rescueDurations.push(Math.max(0, (transactionTime - rescueTime) / 1000))

      if (!lastRecoveredAt || transactionTime > Date.parse(lastRecoveredAt)) {
        lastRecoveredAt = transaction.updated_at
        lastRecoveredAmountCents = toCents(transaction.amount)
      }
    }

    for (const signal of signals) {
      const productId = signal.product_id
      if (!productId) continue
      const product = metrics.get(productId) ?? {
        productId,
        productName: text(signal.payload.productName) ?? productId,
        totalInterventions: 0,
        successfulRecoveries: 0,
        totalRevenueSavedCents: 0,
        conversionRatePercent: 0,
      }
      product.totalInterventions += 1
      product.conversionRatePercent = product.totalInterventions > 0
        ? Number(((product.successfulRecoveries / product.totalInterventions) * 100).toFixed(1))
        : 0
      metrics.set(productId, product)
    }

    const products = Array.from(metrics.values())
      .map((product) => ({
        ...product,
        conversionRatePercent: product.totalInterventions > 0
          ? Number(((product.successfulRecoveries / product.totalInterventions) * 100).toFixed(1))
          : 0,
      }))
      .sort((a, b) => b.totalRevenueSavedCents - a.totalRevenueSavedCents)

    setRoiData({
      totalRecoveredRevenueCents: products.reduce((sum, product) => sum + product.totalRevenueSavedCents, 0),
      averageRescueTimeSeconds: rescueDurations.length
        ? Number((rescueDurations.reduce((sum, value) => sum + value, 0) / rescueDurations.length).toFixed(1))
        : null,
      products,
      lastRecoveredAt,
      lastRecoveredAmountCents,
    })
    setError(null)
    setLoading(false)
  }

  useEffect(() => {
    let active = true
    void load().catch((cause: unknown) => {
      if (!active) return
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o ROI.')
      setLoading(false)
    })

    const timer = window.setInterval(() => {
      if (active) void load().catch(() => undefined)
    }, REFRESH_MS)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [userId])

  const currency = useMemo(() => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }), [])

  return (
    <section className="min-h-full bg-[#09090b] text-zinc-100 antialiased">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-32 pt-6 sm:px-6 lg:px-8 md:pb-8">
        <header className="flex flex-col gap-3 border-b border-zinc-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-zinc-500">IARA / ATRIBUIÇÃO DE RECEITA</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">Performance de recuperação</h1>
            <p className="mt-1 text-sm text-zinc-500">Somente receita com evidência comportamental + intervenção + aprovação.</p>
          </div>
          <span className="w-fit rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 font-mono text-[10px] text-emerald-400">LIVE · DADOS REAIS</span>
        </header>

        {error && <div role="alert" className="rounded-lg border border-red-900/60 bg-red-950/20 px-4 py-3 text-sm text-red-300">{error}</div>}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Metric label="Receita recuperada" value={loading ? '—' : currency.format(roiData.totalRecoveredRevenueCents / 100)} />
          <Metric label="Tempo médio até aprovação" value={roiData.averageRescueTimeSeconds === null ? '—' : `${roiData.averageRescueTimeSeconds}s`} />
          <Metric label="Última recuperação atribuída" value={roiData.lastRecoveredAmountCents === null ? '—' : currency.format(roiData.lastRecoveredAmountCents / 100)} detail={roiData.lastRecoveredAt ? new Date(roiData.lastRecoveredAt).toLocaleTimeString('pt-BR') : undefined} />
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40">
          <div className="border-b border-zinc-800 px-4 py-3 font-mono text-xs text-zinc-400">RECUPERAÇÃO POR PRODUTO</div>
          <div className="space-y-6 p-4 sm:p-6">
            {loading && <div className="h-20 animate-pulse rounded-lg bg-zinc-900" />}
            {!loading && roiData.products.length === 0 && <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-10 text-center text-sm text-zinc-500">Nenhuma recuperação atribuída no período de 30 minutos.</div>}
            {!loading && roiData.products.map((product) => (
              <article key={product.productId}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm font-medium text-zinc-200">{product.productName}</span>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-zinc-500">
                    <span>Gatilhos: {product.totalInterventions}</span>
                    <span>Salvos: <b className="text-emerald-400">{product.successfulRecoveries}</b></span>
                    <span className="text-zinc-300">{currency.format(product.totalRevenueSavedCents / 100)}</span>
                  </div>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full border border-zinc-800 bg-zinc-950">
                  <div className="h-full rounded-full bg-emerald-400 transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(0, product.conversionRatePercent))}%` }} />
                </div>
                <div className="mt-1 text-right font-mono text-[10px] text-zinc-500">Eficácia: <span className="text-zinc-300">{product.conversionRatePercent}%</span></div>
              </article>
            ))}
          </div>
        </div>

        <p className="font-mono text-[10px] text-zinc-600">Janela causal: {WINDOW_MINUTES} min · Atualização observada: {REFRESH_MS / 1000}s · Fonte financeira: gateway_transactions</p>
      </div>
    </section>
  )
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
      <span className="text-xs text-zinc-500">{label}</span>
      <div className="mt-2 font-mono text-2xl font-semibold tracking-tight text-white">{value}</div>
      {detail && <div className="mt-1 font-mono text-[10px] text-zinc-600">{detail}</div>}
    </div>
  )
}
