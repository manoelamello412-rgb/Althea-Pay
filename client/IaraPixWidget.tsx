'use client'

import React, { useEffect, useMemo, useState } from 'react'

export interface IaraPixWidgetProps {
  pixId: string
  copyAndPasteCode: string
  expiresAt: string
  amountCents: number
  productName: string
  status?: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELED'
  onClose: () => void
}

function formatCurrency(amountCents: number): string {
  return (amountCents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

function remainingSeconds(expiresAt: string, nowMs: number): number {
  const expiry = Date.parse(expiresAt)
  if (!Number.isFinite(expiry)) return 0
  return Math.max(0, Math.ceil((expiry - nowMs) / 1000))
}

function formatRemaining(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

export const IaraPixWidget: React.FC<IaraPixWidgetProps> = ({
  pixId,
  copyAndPasteCode,
  expiresAt,
  amountCents,
  productName,
  status = 'PENDING',
  onClose,
}) => {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  useEffect(() => {
    if (status !== 'PENDING') return
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [status])

  const timeLeft = useMemo(() => remainingSeconds(expiresAt, nowMs), [expiresAt, nowMs])
  const effectiveExpired = status === 'EXPIRED' || (status === 'PENDING' && timeLeft === 0)
  const paid = status === 'PAID'
  const unavailable = paid || effectiveExpired || status === 'CANCELED'

  const handleCopy = async (): Promise<void> => {
    if (unavailable) return
    setCopyError(false)

    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(copyAndPasteCode)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2200)
    } catch {
      setCopyError(true)
    }
  }

  const statusLabel = paid
    ? 'Pagamento confirmado'
    : effectiveExpired
      ? 'PIX expirado'
      : status === 'CANCELED'
        ? 'PIX cancelado'
        : 'Aguardando pagamento'

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="iara-pix-title"
    >
      <section className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/60">
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              <span className={`h-1.5 w-1.5 rounded-full ${paid ? 'bg-emerald-400' : effectiveExpired ? 'bg-red-400' : 'animate-pulse bg-violet-400'}`} />
              IARA · PIX
            </div>
            <h2 id="iara-pix-title" className="mt-1 text-sm font-semibold">Pagamento</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-xs text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200" aria-label="Fechar pagamento">
            Fechar
          </button>
        </header>

        <div className="space-y-5 p-5">
          <div>
            <p className="text-xs text-zinc-500">Você está adquirindo</p>
            <p className="mt-1 text-sm font-medium text-zinc-100">{productName}</p>
            <div className="mt-3 flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
              <span className="text-xs text-zinc-500">Valor</span>
              <span className="font-mono text-lg font-semibold text-white">{formatCurrency(amountCents)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">PIX copia e cola</span>
              <span className="font-mono text-[9px] text-zinc-600">{pixId}</span>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              disabled={unavailable}
              className="max-h-24 w-full overflow-y-auto rounded-xl border border-zinc-800 bg-black p-3 text-left font-mono text-[10px] leading-4 text-zinc-400 transition hover:border-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Copiar código PIX"
            >
              <span className="break-all select-all">{copyAndPasteCode}</span>
            </button>
          </div>

          <div className="border-t border-zinc-800 pt-4">
            {paid ? (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center">
                <p className="text-sm font-semibold text-emerald-300">Pagamento confirmado</p>
                <p className="mt-1 text-xs text-zinc-500">A liquidação foi reconhecida pelo sistema.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">{statusLabel}</p>
                  <p className={`mt-1 font-mono text-xl font-bold ${timeLeft <= 60 ? 'text-red-300' : 'text-zinc-100'}`} aria-live="polite">
                    {effectiveExpired ? 'EXPIRADO' : formatRemaining(timeLeft)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={unavailable}
                  className="h-11 w-full rounded-xl bg-white px-5 text-xs font-semibold text-black transition hover:bg-zinc-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
                >
                  {copied ? 'Código copiado' : 'Copiar PIX'}
                </button>
              </div>
            )}

            {copyError && (
              <p className="mt-3 text-xs text-red-300" role="alert">
                Não foi possível copiar automaticamente. Selecione o código acima e copie manualmente.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
