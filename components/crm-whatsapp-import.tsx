'use client'

import { useRef, useState } from 'react'
import { Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Group = { id: string; name: string; size: number }

const errors: Record<string, string> = {
  WHATSAPP_NOT_CONNECTED: 'Conecte o WhatsApp em CRM › Configurações primeiro.',
  WHATSAPP_BRIDGE_NOT_CONFIGURED: 'Servidor do WhatsApp não configurado.',
  WHATSAPP_BRIDGE_UNREACHABLE: 'Servidor do WhatsApp fora do ar.',
  FORBIDDEN: 'Seu acesso não permite importar leads.',
}
const message = (code?: string) => errors[code ?? ''] ?? 'Falha ao falar com o WhatsApp.'

// Lists the groups of the connected WhatsApp (Baileys) and imports a group's participants as leads (clients).
export function CrmWhatsappImport() {
  const dialog = useRef<HTMLDialogElement>(null)
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  async function open() {
    dialog.current?.showModal()
    setGroups(null); setStatus(null)
    const res = await fetch('/api/crm/whatsapp/groups', { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (res.ok) setGroups(data.groups ?? [])
    else { setGroups([]); setStatus(message(data.error)) }
  }

  async function importGroup(group: Group) {
    setBusy(group.id); setStatus(null)
    try {
      const res = await fetch('/api/crm/whatsapp/groups', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ group_id: group.id }) })
      const data = await res.json().catch(() => ({}))
      setStatus(res.ok
        ? `${data.imported} lead(s) importado(s) de "${group.name}"${data.list ? ` na lista "${data.list}"` : ''}${data.skipped ? ` · ${data.skipped} sem número visível ignorado(s)` : ''}.`
        : message(data.error))
    } finally { setBusy(null) }
  }

  const visible = (groups ?? []).filter(g => g.name.toLowerCase().includes(search.trim().toLowerCase()))

  return <>
    <button type="button" onClick={() => void open()} className="rounded-lg border border-white/[.07] px-2.5 py-2 text-[9px] font-bold text-slate-400 transition hover:border-[#1DB854]/20 hover:text-[#63e08a]">IMPORTAR LEADS</button>
    <dialog ref={dialog} className="m-auto w-[min(520px,calc(100vw-32px))] rounded-2xl border border-white/10 bg-[#0B0F0D] p-0 text-slate-100 backdrop:bg-black/70">
      <div className="flex items-center justify-between border-b border-white/10 p-4">
        <b className="text-sm">Importar leads de grupos do WhatsApp</b>
        <Button type="button" variant="ghost" size="icon" onClick={() => dialog.current?.close()} aria-label="Fechar" title="Fechar"><X size={16}/></Button>
      </div>
      <div className="p-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar grupo..." className="w-full rounded-xl border border-white/10 bg-white/[.025] px-3 py-2 text-xs outline-none placeholder:text-slate-600"/>
        {status && <div className="mt-3 rounded-xl border border-white/10 bg-white/[.03] p-3 text-xs text-slate-300" role="status">{status}</div>}
        <div className="mt-3 max-h-[60vh] space-y-1.5 overflow-y-auto">
          {groups === null ? [1, 2, 3].map(x => <div key={x} className="h-12 animate-pulse rounded-xl bg-white/[.03]"/>)
            : visible.length === 0 ? <div className="p-6 text-center text-xs text-slate-600">Nenhum grupo encontrado.</div>
            : visible.map(g => <div key={g.id} className="flex items-center gap-3 rounded-xl border border-white/[.06] p-3">
                <Users size={15} className="shrink-0 text-slate-500"/>
                <div className="min-w-0 flex-1"><b className="block truncate text-xs">{g.name}</b><span className="text-[10px] text-slate-600">{g.size} participantes</span></div>
                <Button type="button" size="sm" disabled={busy !== null} onClick={() => void importGroup(g)}>{busy === g.id ? 'Importando...' : 'Importar'}</Button>
              </div>)}
        </div>
      </div>
    </dialog>
  </>
}
