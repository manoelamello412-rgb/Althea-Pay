'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

// Inside the dashboard layout, so a crash in one module keeps the menu and the other modules reachable.
export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error('[ALTHEA-DASHBOARD] route error', error) }, [error])
  const offline = typeof navigator !== 'undefined' && !navigator.onLine

  return <main className="flex min-h-[70vh] items-center justify-center px-4 text-slate-100">
    <section role="alert" className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0B0F0D] p-6 text-center">
      <AlertTriangle className="mx-auto text-amber-400" size={28} />
      <h1 className="mt-3 text-lg font-black">{offline ? 'Sem conexão' : 'Esta tela não carregou'}</h1>
      <p className="mt-2 text-sm text-slate-400">{offline ? 'Verifique a internet e tente de novo.' : 'O erro foi registrado. Tente de novo; se persistir, use o menu para seguir em outro módulo.'}</p>
      {error.digest && <p className="mt-2 text-[10px] text-slate-600">Código: {error.digest}</p>}
      <button type="button" onClick={() => retry()} className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-black hover:bg-emerald-400"><RefreshCw size={15} /> Tentar de novo</button>
    </section>
  </main>
}
