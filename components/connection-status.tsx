'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, WifiOff } from 'lucide-react'

// Global offline / reconnection notice for the dashboard. Screens load their data on mount, so after a
// reconnection the operator is offered a reload instead of silently looking at stale numbers.
export function ConnectionStatus() {
  const [state, setState] = useState<'online' | 'offline' | 'reconnected'>('online')

  useEffect(() => {
    if (!navigator.onLine) setState('offline')
    const offline = () => setState('offline')
    const online = () => setState(current => current === 'offline' ? 'reconnected' : current)
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', online) }
  }, [])

  if (state === 'online') return null
  return <div role="status" aria-live="polite" className={`fixed inset-x-3 top-3 z-[60] mx-auto flex max-w-xl items-center gap-3 rounded-2xl border px-4 py-3 text-sm shadow-2xl ${state === 'offline' ? 'border-amber-500/30 bg-[#1a1408] text-amber-200' : 'border-emerald-500/30 bg-[#0b1a11] text-emerald-200'}`}>
    {state === 'offline' ? <><WifiOff size={16} className="shrink-0" /><span>Sem conexão. Os dados na tela podem estar desatualizados e ações não serão enviadas.</span></>
      : <><RefreshCw size={16} className="shrink-0" /><span className="flex-1">Conexão restabelecida.</span><button type="button" onClick={() => window.location.reload()} className="rounded-lg border border-emerald-500/30 px-3 py-1 text-xs font-bold hover:bg-emerald-500/10">Atualizar dados</button><button type="button" onClick={() => setState('online')} aria-label="Fechar aviso" className="text-xs text-emerald-300/70 hover:text-emerald-200">Fechar</button></>}
  </div>
}
