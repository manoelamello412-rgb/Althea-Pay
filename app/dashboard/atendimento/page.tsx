'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Headphones, Loader2, MessageCircle, Phone, RefreshCw, UserRound } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { hasOrganizationCapability, parseOrganizationAccess, type OrganizationAccess } from '@/lib/auth/organization-access'
import { CrmCallDialog, OUTCOME_LABEL, type Outcome } from '@/components/crm-call-dialog'

type Reason = 'callback_due' | 'retry' | 'never_called' | 'callback_scheduled'
type Item = {
  client_id: string; reason: Reason; card_id: string | null; stage_name: string | null; owner_id: string | null
  last_call_outcome: Outcome | null; last_called_at: string | null; callback_at: string | null; stage_entered_at: string | null
  conversation_id: string | null; name: string | null; email: string | null; phone: string | null
}
type Member = { user_id: string; name: string | null }

const REASONS: { id: Reason; label: string; hint: string; tone: string }[] = [
  { id: 'callback_due', label: 'Retornos vencidos', hint: 'Pediram retorno e o horário já passou.', tone: 'text-red-400' },
  { id: 'retry', label: 'Tentar de novo', hint: 'Não atenderam, ocupado ou caixa postal.', tone: 'text-amber-400' },
  { id: 'never_called', label: 'Ainda sem ligação', hint: 'Em etapa em andamento e nunca contatados.', tone: 'text-slate-300' },
  { id: 'callback_scheduled', label: 'Retornos agendados', hint: 'Retorno marcado para mais tarde.', tone: 'text-emerald-400' },
]
const when = (value: string) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export default function AtendimentoPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [access, setAccess] = useState<OrganizationAccess | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [onlyMine, setOnlyMine] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [call, setCall] = useState<Item | null>(null)

  const canCall = hasOrganizationCapability(access, 'can_view_customers') && hasOrganizationCapability(access, 'can_reply_chats')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const accessResult = await db.rpc('organization_my_access_v1', { p_organization_id: null })
      if (accessResult.error) throw accessResult.error
      const current = parseOrganizationAccess(accessResult.data)
      setAccess(current)
      if (!current || !hasOrganizationCapability(current, 'can_view_customers')) { setItems([]); return }
      const result = await db.rpc('crm_call_queue_v1', { p_only_mine: onlyMine })
      if (result.error) throw result.error
      const data = (result.data ?? {}) as { items?: Item[]; members?: Member[] }
      setItems(data.items ?? [])
      setMembers(data.members ?? [])
    } catch (cause) {
      console.error('[ALTHEA-ATENDIMENTO]', cause)
      setError('Não foi possível carregar a fila de atendimento.')
    } finally { setLoading(false) }
  }, [db, onlyMine])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!access) return
    const channel = db.channel(`call-desk-${access.organization_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_pipeline_cards', filter: `organization_id=eq.${access.organization_id}` }, () => void load())
      .subscribe()
    return () => { void db.removeChannel(channel) }
  }, [access, db, load])

  const memberName = (id: string | null) => id ? members.find(member => member.user_id === id)?.name || `Membro ${id.slice(0, 6)}` : 'Sem responsável'

  return <main className="min-h-screen bg-[#070A09] px-4 py-6 text-slate-100 lg:px-8">
    <div className="mx-auto max-w-[1400px]">
      <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><div className="mb-2 text-[10px] font-black uppercase tracking-[.28em] text-emerald-400">ALTHEA PAY // ATENDIMENTO</div><h1 className="text-3xl font-black tracking-tight">Atendimento</h1><p className="mt-1 text-sm text-slate-500">Quem ligar agora. O resultado de cada ligação atualiza o cliente e a etapa no Kanban.</p></div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Filtro" className="flex rounded-xl border border-white/10 p-1 text-sm">
            <button type="button" aria-pressed={!onlyMine} onClick={() => setOnlyMine(false)} className={`rounded-lg px-3 py-1.5 ${!onlyMine ? 'bg-white/10 font-semibold' : 'text-slate-400'}`}>Todos</button>
            <button type="button" aria-pressed={onlyMine} onClick={() => setOnlyMine(true)} className={`rounded-lg px-3 py-1.5 ${onlyMine ? 'bg-white/10 font-semibold' : 'text-slate-400'}`}>Meus</button>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} aria-label="Atualizar" className="inline-flex h-10 items-center rounded-xl border border-white/10 bg-white/[.03] px-3 hover:bg-white/[.06] disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </header>

      {error && <div role="alert" className="mb-4 rounded-xl border border-red-500/20 bg-red-500/[.06] px-4 py-3 text-sm text-red-300">{error} <button type="button" onClick={() => void load()} className="underline">Tentar de novo</button></div>}
      {notice && <div role="status" className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[.06] px-4 py-3 text-sm text-emerald-300">{notice}</div>}

      {loading && !items.length ? <div className="flex min-h-64 items-center justify-center gap-2 text-slate-500"><Loader2 className="animate-spin text-emerald-400" size={20} /> Carregando fila</div>
        : access && !hasOrganizationCapability(access, 'can_view_customers') ? <div className="rounded-2xl border border-white/10 bg-white/[.02] p-8 text-center text-sm text-slate-500">Seu acesso não inclui visualizar clientes.</div>
        : !items.length && !error ? <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[.02] text-center"><Headphones size={26} className="text-slate-600" /><strong>Fila vazia</strong><p className="max-w-md text-sm text-slate-500">{onlyMine ? 'Nenhum cliente seu aguardando ligação.' : 'Nenhum cliente aguardando ligação. Clientes entram aqui pelo Kanban e pelos retornos agendados.'}</p></div>
        : <div className="space-y-6">{REASONS.map(reason => {
          const group = items.filter(item => item.reason === reason.id)
          if (!group.length) return null
          return <section key={reason.id} aria-label={reason.label}>
            <div className="mb-2 flex items-baseline gap-2"><h2 className={`text-sm font-bold ${reason.tone}`}>{reason.label}</h2><span className="text-xs text-slate-500">{group.length} · {reason.hint}</span></div>
            <ul className="divide-y divide-white/[.06] rounded-2xl border border-white/10 bg-white/[.02]">{group.map(item => <li key={item.client_id} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center">
              <div className="min-w-0 flex-1">
                <b className="block truncate text-sm">{item.name || 'Cliente sem nome'}</b>
                <span className="block truncate text-xs text-slate-500">{item.phone || 'sem telefone'}{item.email ? ` · ${item.email}` : ''}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 md:w-[28rem]">
                <span>{item.stage_name ?? 'Fora do Kanban'}</span>
                <span>{memberName(item.owner_id)}</span>
                {item.callback_at && (item.reason === 'callback_due' || item.reason === 'callback_scheduled') ? <span className={reason.tone}>retornar {when(item.callback_at)}</span>
                  : item.last_called_at ? <span>{item.last_call_outcome ? OUTCOME_LABEL[item.last_call_outcome] : 'ligação'} em {when(item.last_called_at)}</span>
                  : item.stage_entered_at ? <span>na etapa desde {when(item.stage_entered_at)}</span> : null}
              </div>
              <div className="flex items-center gap-1">
                {item.conversation_id && <a href={`/dashboard/crm?conversation=${item.conversation_id}`} aria-label={`Abrir conversa de ${item.name ?? 'cliente'}`} className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-emerald-400"><MessageCircle size={15} /></a>}
                {item.conversation_id && <a href={`/dashboard/crm/customer-360?conversation=${item.conversation_id}`} aria-label={`Abrir cliente 360 de ${item.name ?? 'cliente'}`} className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-emerald-400"><UserRound size={15} /></a>}
                {canCall && <button type="button" onClick={() => { setNotice(''); setCall(item) }} className="inline-flex h-9 items-center gap-2 rounded-xl bg-emerald-500 px-3 text-sm font-bold text-black hover:bg-emerald-400"><Phone size={14} /> Atender</button>}
              </div>
            </li>)}</ul>
          </section>
        })}</div>}
    </div>
    {call && <CrmCallDialog clientId={call.client_id} cardId={call.card_id} onClose={() => setCall(null)} onLogged={() => { setCall(null); setNotice('Ligação registrada.'); void load() }} />}
  </main>
}
