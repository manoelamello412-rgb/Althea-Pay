'use client'

import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, Download, Network, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { leadsCsv, uniqueByPhone, type LeadRow } from '@/lib/crm/leads-csv'

type Account = { id: string; display_name: string | null; external_account_id: string | null; status: string }
type Group = { id: string; name: string; size: number; isCommunity?: boolean; linkedParent?: string | null }
type Picked = { kind: 'group' | 'community'; id: string; name: string; members: LeadRow[]; skipped: number } | null

const errors: Record<string, string> = {
  WHATSAPP_NOT_CONNECTED: 'Este número não está conectado. Pareie em CRM › Configurações.',
  WHATSAPP_BRIDGE_NOT_CONFIGURED: 'Servidor do WhatsApp offline: o administrador precisa configurar WHATSAPP_BRIDGE_URL e WHATSAPP_BRIDGE_TOKEN.',
  WHATSAPP_BRIDGE_UNREACHABLE: 'Servidor do WhatsApp fora do ar. Tente de novo em alguns minutos.',
  FORBIDDEN: 'Seu acesso não permite importar leads.',
}
const message = (code?: string) => errors[code ?? ''] ?? 'Falha ao falar com o WhatsApp.'

// Lead extractor: pick a QR Code (Baileys) number, then a group or community, choose participants,
// export CSV and/or import them as leads. Infobip numbers have no access to groups.
export function CrmWhatsappImport() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const dialog = useRef<HTMLDialogElement>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [account, setAccount] = useState('')
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Picked>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  async function loadGroups(id: string) {
    setAccount(id); setGroups(null); setPicked(null); setStatus(null)
    if (!id) { setGroups([]); return }
    const res = await fetch(`/api/crm/whatsapp/groups?account=${id}`, { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (res.ok) setGroups(data.groups ?? [])
    else { setGroups([]); setStatus(message(data.error)) }
  }

  async function open() {
    dialog.current?.showModal()
    setStatus(null); setPicked(null)
    const { data } = await db.from('crm_channel_accounts').select('id,display_name,external_account_id,status')
      .eq('channel', 'whatsapp').eq('provider', 'baileys').order('created_at')
    const list = (data ?? []) as Account[]
    setAccounts(list)
    const first = list.find(a => a.status === 'active') ?? list[0]
    if (first) await loadGroups(first.id)
    else { setGroups([]); setStatus('Nenhum número por QR Code. Conecte um em CRM › Configurações (a Infobip não acessa grupos).') }
  }

  async function pick(kind: 'group' | 'community', group: Group) {
    setBusy(true); setStatus(null)
    const res = await fetch(`/api/crm/whatsapp/groups?account=${account}&${kind}=${encodeURIComponent(group.id)}`, { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setStatus(message(data.error)); return }
    const members = uniqueByPhone((data.members ?? []) as LeadRow[])
    setPicked({ kind, id: group.id, name: data.name ?? group.name, members, skipped: Number(data.skipped ?? 0) })
    setChecked(new Set(members.filter(m => !m.known).map(m => m.phone)))
  }

  const selected = picked?.members.filter(m => checked.has(m.phone)) ?? []
  const toggle = (phone: string) => setChecked(current => { const next = new Set(current); if (next.has(phone)) next.delete(phone); else next.add(phone); return next })
  const allChecked = !!picked && picked.members.length > 0 && picked.members.every(m => checked.has(m.phone))

  function exportCsv() {
    if (!picked || !selected.length) return
    const url = URL.createObjectURL(new Blob([leadsCsv(selected, picked.name)], { type: 'text/csv;charset=utf-8' }))
    const link = Object.assign(document.createElement('a'), { href: url, download: `leads-${picked.name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60) || 'grupo'}.csv` })
    link.click()
    URL.revokeObjectURL(url)
  }

  async function importSelected() {
    if (!picked || !selected.length) return
    setBusy(true); setStatus(null)
    const res = await fetch('/api/crm/whatsapp/groups', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: picked.name, contacts: selected.map(({ phone, name }) => ({ phone, name })) }) })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setStatus(message(data.error)); return }
    setStatus(`${data.imported} lead(s) na lista "${data.list}" · ${data.new} novo(s) na base, ${data.imported - data.new} já existia(m).`)
    setPicked(current => current && { ...current, members: current.members.map(m => checked.has(m.phone) ? { ...m, known: true } : m) })
    setChecked(new Set())
  }

  const term = search.trim().toLowerCase()
  const communities = (groups ?? []).filter(g => g.isCommunity && g.name.toLowerCase().includes(term))
  const plain = (groups ?? []).filter(g => !g.isCommunity && g.name.toLowerCase().includes(term))
  const row = 'flex items-center gap-3 rounded-xl border border-white/[.06] p-3'

  return <>
    <button type="button" onClick={() => void open()} className="rounded-lg border border-white/[.07] px-2.5 py-2 text-[9px] font-bold text-slate-400 transition hover:border-[#1DB854]/20 hover:text-[#63e08a]">EXTRAIR LEADS</button>
    <dialog ref={dialog} className="m-auto w-[min(640px,calc(100vw-32px))] rounded-2xl border border-white/10 bg-[#0B0F0D] p-0 text-slate-100 backdrop:bg-black/70">
      <div className="flex items-center justify-between border-b border-white/10 p-4">
        <div className="flex items-center gap-2">
          {picked && <Button type="button" variant="ghost" size="icon" onClick={() => setPicked(null)} aria-label="Voltar aos grupos" title="Voltar"><ChevronLeft size={16}/></Button>}
          <b className="text-sm">{picked ? picked.name : 'Extrair leads de grupos do WhatsApp'}</b>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={() => dialog.current?.close()} aria-label="Fechar" title="Fechar"><X size={16}/></Button>
      </div>
      <div className="p-4">
        {status && <div className="mb-3 rounded-xl border border-white/10 bg-white/[.03] p-3 text-xs text-slate-300" role="status">{status}</div>}
        {!picked ? <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select aria-label="Número do WhatsApp" value={account} onChange={e => void loadGroups(e.target.value)} className="rounded-xl border border-white/10 bg-[#0B0F0D] px-3 py-2 text-xs outline-none">
              {accounts.length === 0 && <option value="">Nenhum número</option>}
              {accounts.map(a => <option key={a.id} value={a.id}>{a.display_name || (a.external_account_id ? `+${a.external_account_id}` : 'Número')}{a.status !== 'active' ? ' (desconectado)' : ''}</option>)}
            </select>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar grupo ou comunidade..." className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[.025] px-3 py-2 text-xs outline-none placeholder:text-slate-600"/>
          </div>
          <div className="mt-3 max-h-[60vh] space-y-1.5 overflow-y-auto">
            {groups === null ? [1, 2, 3].map(x => <div key={x} className="h-12 animate-pulse rounded-xl bg-white/[.03]"/>)
              : communities.length + plain.length === 0 ? <div className="p-6 text-center text-xs text-slate-600">Nenhum grupo encontrado.</div>
              : <>
                {communities.map(g => <div key={g.id} className={row}>
                  <Network size={15} className="shrink-0 text-sky-400"/>
                  <div className="min-w-0 flex-1"><b className="block truncate text-xs">{g.name}</b><span className="text-[10px] text-slate-500">Comunidade · {(groups ?? []).filter(x => x.linkedParent === g.id).length} grupo(s)</span></div>
                  <Button type="button" size="sm" disabled={busy} onClick={() => void pick('community', g)}>Ver membros</Button>
                </div>)}
                {plain.map(g => <div key={g.id} className={row}>
                  <Users size={15} className="shrink-0 text-slate-500"/>
                  <div className="min-w-0 flex-1"><b className="block truncate text-xs">{g.name}</b><span className="text-[10px] text-slate-600">{g.size} participantes{g.linkedParent ? ' · de uma comunidade' : ''}</span></div>
                  <Button type="button" size="sm" disabled={busy} onClick={() => void pick('group', g)}>Ver membros</Button>
                </div>)}
              </>}
          </div>
        </> : <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-2"><input type="checkbox" checked={allChecked} onChange={() => setChecked(allChecked ? new Set() : new Set(picked.members.map(m => m.phone)))} className="accent-emerald-500"/> Marcar todos</label>
            <span className="text-slate-500">{picked.members.length} com telefone · {picked.members.filter(m => m.known).length} já são clientes{picked.skipped ? ` · ${picked.skipped} sem número visível` : ''}</span>
          </div>
          <div className="mt-3 max-h-[50vh] divide-y divide-white/[.05] overflow-y-auto rounded-xl border border-white/[.06]">
            {picked.members.length === 0 ? <div className="p-6 text-center text-xs text-slate-600">Nenhum participante com telefone visível.</div>
              : picked.members.map(m => <label key={m.phone} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-xs hover:bg-white/[.03]">
                <input type="checkbox" checked={checked.has(m.phone)} onChange={() => toggle(m.phone)} className="accent-emerald-500"/>
                <span className="min-w-0 flex-1 truncate">{m.name || <span className="text-slate-600">sem nome</span>}</span>
                <span className="font-mono text-slate-400">+{m.phone}</span>
                {m.known && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">já é cliente</span>}
              </label>)}
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" disabled={!selected.length} onClick={exportCsv}><Download size={14}/> Exportar CSV ({selected.length})</Button>
            <Button type="button" disabled={busy || !selected.length} onClick={() => void importSelected()}>{busy ? 'Importando...' : `Importar ${selected.length} como leads`}</Button>
          </div>
        </>}
      </div>
    </dialog>
  </>
}
