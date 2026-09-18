'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, RefreshCw, ShieldCheck } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type AuditLog = {
  id: string
  organization_id: string | null
  actor_id: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

const PAGE_SIZE = 50

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(value))
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    insert: 'Criado',
    update: 'Atualizado',
    delete: 'Excluído',
  }
  return labels[action] ?? action
}

export default function SecurityAuditPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)

  const load = useCallback(async (nextOffset = 0, append = false) => {
    setError(null)
    if (append) setRefreshing(true)
    else setLoading(true)

    const { data: sessionData, error: sessionError } = await supabase.auth.getUser()
    if (sessionError || !sessionData.user) {
      router.replace('/login')
      return
    }

    const { data, error: queryError } = await supabase
      .from('audit_logs')
      .select('id,organization_id,actor_id,action,resource_type,resource_id,metadata,created_at')
      .order('created_at', { ascending: false })
      .range(nextOffset, nextOffset + PAGE_SIZE)

    if (queryError) {
      setError(queryError.message)
      if (!append) setLogs([])
      setHasMore(false)
    } else {
      const rows = (data ?? []) as AuditLog[]
      const page = rows.slice(0, PAGE_SIZE)
      setLogs(current => append ? [...current, ...page] : page)
      setOffset(nextOffset + PAGE_SIZE)
      setHasMore(rows.length > PAGE_SIZE)
    }

    setLoading(false)
    setRefreshing(false)
  }, [router, supabase])

  useEffect(() => {
    void load()
    const channel = supabase
      .channel('security-audit-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, () => void load())
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [load, supabase])

  if (loading) return <main className="min-h-screen bg-[#070A09] px-4 py-8 text-slate-100"><div className="mx-auto max-w-6xl text-sm text-slate-500">Carregando trilha de auditoria…</div></main>

  return <main className="min-h-screen bg-[#070A09] px-4 py-6 text-slate-100 lg:px-8">
    <div className="mx-auto max-w-[1200px]">
      <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[.28em] text-emerald-400"><ShieldCheck size={14} /> ALTHEA PAY // AUDITORIA</div>
          <h1 className="text-3xl font-black tracking-tight">Trilha de auditoria</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">Registro operacional canônico das alterações protegidas pela infraestrutura do ALTHEA PAY. A visualização respeita o isolamento por organização do banco.</p>
        </div>
        <button onClick={() => void load()} disabled={refreshing} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[.03] px-4 py-3 text-sm font-semibold transition hover:bg-white/[.06] disabled:opacity-50"><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Atualizar</button>
      </header>

      {error ? <section className="rounded-2xl border border-red-400/20 bg-red-400/[.04] p-5 text-sm text-red-200">Não foi possível carregar a auditoria: {error}</section> : logs.length === 0 ? <section className="rounded-2xl border border-white/10 bg-white/[.025] p-10 text-center"><Activity size={24} className="mx-auto mb-4 text-slate-600" /><h2 className="font-bold">Nenhum evento de auditoria</h2><p className="mt-2 text-sm text-slate-500">Ainda não existem alterações registradas para as organizações acessíveis nesta sessão.</p></section> : <>
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[.02]">
          <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="border-b border-white/[.06] bg-white/[.025] text-[10px] uppercase tracking-widest text-slate-600"><tr><th className="px-5 py-4">Data</th><th className="px-5 py-4">Ação</th><th className="px-5 py-4">Recurso</th><th className="px-5 py-4">ID do recurso</th><th className="px-5 py-4">Ator</th></tr></thead><tbody>{logs.map(log => <tr key={log.id} className="border-b border-white/[.05] last:border-0"><td className="whitespace-nowrap px-5 py-4 text-slate-400">{formatDate(log.created_at)}</td><td className="px-5 py-4"><span className="rounded-full border border-emerald-400/15 bg-emerald-400/[.06] px-2.5 py-1 text-xs font-semibold text-emerald-300">{actionLabel(log.action)}</span></td><td className="px-5 py-4 font-semibold text-slate-200">{log.resource_type ?? '—'}</td><td className="max-w-[260px] truncate px-5 py-4 font-mono text-xs text-slate-500" title={log.resource_id ?? undefined}>{log.resource_id ?? '—'}</td><td className="max-w-[260px] truncate px-5 py-4 font-mono text-xs text-slate-500" title={log.actor_id ?? undefined}>{log.actor_id ?? 'sistema'}</td></tr>)}</tbody></table></div>
        </section>
        {hasMore && <div className="mt-5 text-center"><button onClick={() => void load(offset, true)} disabled={refreshing} className="rounded-xl border border-white/10 bg-white/[.03] px-5 py-3 text-sm font-semibold hover:bg-white/[.06] disabled:opacity-50">Carregar mais</button></div>}
      </>}

      <div className="mt-5 flex items-center justify-between gap-4 text-xs text-slate-600"><span>{logs.length} evento(s) carregado(s)</span><a href="/dashboard/security" className="text-slate-400 hover:text-slate-200">Voltar para Segurança</a></div>
    </div>
  </main>
}
