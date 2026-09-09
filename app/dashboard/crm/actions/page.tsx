'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, BrainCircuit, RefreshCw, Target } from 'lucide-react'

type Action = { action_type: string; priority: number; score: number; rationale: string; evidence: Record<string, unknown> }

const labels: Record<string,string> = { respond: 'Responder agora', recover: 'Recuperar receita', upsell: 'Avaliar upsell', queue_review: 'Revisar fila' }

export default function CRMNextBestActionsPage() {
  const [conversation, setConversation] = useState('')
  const [actions, setActions] = useState<Action[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load(id?: string) {
    setLoading(true); setError('')
    try {
      const qs = id ? `?conversation=${encodeURIComponent(id)}` : ''
      const r = await fetch(`/api/crm/next-best-actions${qs}`, { cache: 'no-store' })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || 'Não foi possível calcular as ações.')
      setActions(body.actions ?? [])
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao carregar.') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('conversation')?.trim() || ''
    setConversation(id); void load(id || undefined)
  }, [])

  return <main className="min-h-screen bg-[#070A09] px-4 py-6 text-slate-100 lg:px-8">
    <div className="mx-auto max-w-5xl">
      <a href="/dashboard/crm" className="mb-6 inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-white"><ArrowLeft size={15}/> Voltar ao Chat CRM</a>
      <div className="mb-6 rounded-3xl border border-white/10 bg-[#0B0F0D] p-6">
        <div className="flex items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[.2em] text-[#1DB854]"><BrainCircuit size={14}/> Revenue OS</div><h1 className="text-3xl font-black">Next Best Action</h1><p className="mt-2 max-w-2xl text-sm text-slate-500">Prioriza ações a partir de sinais reais da conversa, eventos financeiros e receita observada. Não usa dados fictícios.</p></div><button onClick={()=>void load(conversation || undefined)} className="rounded-xl border border-white/10 p-3 text-slate-400" aria-label="Recalcular"><RefreshCw size={17} className={loading?'animate-spin':''}/></button></div>
      </div>
      {error && <div className="mb-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>}
      <section className="grid gap-3 md:grid-cols-2">
        {!loading && actions.length===0 && <div className="rounded-2xl border border-white/10 bg-[#0B0F0D] p-8 text-sm text-slate-500">Nenhuma ação recomendada para os sinais atuais.</div>}
        {actions.map((a,i)=><article key={`${a.action_type}-${i}`} className="rounded-2xl border border-white/10 bg-[#0B0F0D] p-5"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-black"><Target size={16} className="text-[#1DB854]"/>{labels[a.action_type] ?? a.action_type}</div><span className="rounded-full bg-white/[.05] px-2 py-1 text-[10px] font-black">{Math.round(Number(a.score))}/100</span></div><p className="mt-4 text-sm leading-6 text-slate-300">{a.rationale}</p><div className="mt-4 border-t border-white/[.06] pt-3 text-[10px] text-slate-600">Prioridade operacional: {a.priority}</div></article>)}
      </section>
    </div>
  </main>
}
