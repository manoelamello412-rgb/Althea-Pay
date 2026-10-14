'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquareText } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type QuickReply = { id: string; title: string; body: string; channel: string }

// conversation channel -> quick reply channel (crm_quick_reply_save accepts funnel_chat for the funnel widget)
const replyChannel = (channel?: string) => channel === 'webchat' ? 'funnel_chat' : channel ?? ''

// Active quick replies of the organization, configured in CRM > Configurações. Picking one inserts its text
// into the draft so the operator can still edit it before sending.
export function CrmQuickReplies({ organizationId, channel, disabled, onPick }: { organizationId: string; channel?: string; disabled: boolean; onPick: (body: string) => void }) {
  const [db] = useState(() => createSupabaseBrowserClient())
  const [replies, setReplies] = useState<QuickReply[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!organizationId) return
    let cancelled = false
    void db.from('crm_quick_replies').select('id,title,body,channel').eq('organization_id', organizationId).eq('active', true).order('title').then(result => {
      if (cancelled) return
      if (result.error) { setFailed(true); setReplies([]) } else { setFailed(false); setReplies((result.data ?? []) as QuickReply[]) }
    })
    return () => { cancelled = true }
  }, [db, organizationId])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (replies ?? []).filter(reply => (reply.channel === 'all' || reply.channel === replyChannel(channel)) && (!needle || `${reply.title} ${reply.body}`.toLowerCase().includes(needle)))
  }, [replies, channel, search])

  return <div ref={root} className="relative">
    <button type="button" disabled={disabled} onClick={() => setOpen(value => !value)} aria-expanded={open} aria-label="Respostas rápidas" title="Respostas rápidas" className="rounded-xl p-2 text-slate-500 hover:bg-white/5 hover:text-[#1DB854] disabled:opacity-40"><MessageSquareText size={16} /></button>
    {open && <div role="dialog" aria-label="Respostas rápidas" className="absolute bottom-11 left-0 z-20 w-80 max-w-[85vw] rounded-2xl border border-white/10 bg-[#0B0F0D] p-2 shadow-2xl">
      <input autoFocus value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }} placeholder="Buscar resposta..." className="mb-2 h-9 w-full rounded-xl border border-white/10 bg-white/[.03] px-3 text-xs outline-none focus:border-[#1DB854]/40" />
      <ul className="max-h-64 overflow-y-auto">
        {replies === null && <li className="px-2 py-3 text-xs text-slate-500">Carregando...</li>}
        {failed && <li className="px-2 py-3 text-xs text-red-300">Não foi possível carregar as respostas rápidas.</li>}
        {replies !== null && !failed && !visible.length && <li className="px-2 py-3 text-xs text-slate-500">{replies.length ? 'Nenhuma resposta para este canal ou busca.' : <>Nenhuma resposta cadastrada. Crie em <a href="/dashboard/crm/configuracoes" className="text-[#1DB854] underline">Configurações do CRM</a>.</>}</li>}
        {visible.map(reply => <li key={reply.id}><button type="button" onClick={() => { onPick(reply.body); setOpen(false); setSearch('') }} className="w-full rounded-xl px-2 py-2 text-left hover:bg-white/[.04]"><b className="block truncate text-xs">{reply.title}</b><span className="line-clamp-2 text-[11px] text-slate-500">{reply.body}</span></button></li>)}
      </ul>
    </div>}
  </div>
}
