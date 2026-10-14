'use client'

import { useState } from 'react'
import { FileText, Lock } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Attachment = { kind?: string; bucket?: string; path?: string; file_name?: string; mime_type?: string; transaction_id?: string }

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

export function CrmMessageAttachment({ metadata, canView }: { metadata: unknown; canView: boolean }) {
  const attachment = record(record(metadata)?.attachment) as Attachment | null
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  if (!attachment?.path || !attachment.bucket) return null

  const label = attachment.kind === 'transfer_receipt' ? 'Comprovante de transferência' : 'Anexo'

  async function open() {
    setOpening(true); setError('')
    // Opened before the await so popup blockers treat it as a direct user action.
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    const { data, error: signError } = await createSupabaseBrowserClient().storage
      .from(attachment!.bucket!)
      .createSignedUrl(attachment!.path!, 120)
    setOpening(false)
    if (signError || !data?.signedUrl) { tab?.close(); setError('Não foi possível abrir o arquivo.'); return }
    if (tab) tab.location.href = data.signedUrl
    else window.location.assign(data.signedUrl)
  }

  return (
    <div className="mb-2 rounded-xl border border-white/10 bg-black/20 p-2.5 text-xs">
      <div className="flex items-center gap-2">
        <FileText size={15} className="shrink-0 text-[#1DB854]" />
        <div className="min-w-0 flex-1">
          <b className="block truncate">{label}</b>
          <span className="block truncate text-[10px] text-slate-500">
            {attachment.file_name ?? attachment.mime_type ?? 'arquivo'}{attachment.transaction_id ? ` · transação ${attachment.transaction_id}` : ''}
          </span>
        </div>
        {canView ? (
          <button type="button" onClick={() => void open()} disabled={opening} className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-[10px] font-bold text-slate-300 hover:border-[#1DB854]/30 disabled:opacity-50">
            {opening ? 'Abrindo…' : 'Ver'}
          </button>
        ) : (
          <span className="flex shrink-0 items-center gap-1 text-[10px] text-slate-600" title="Seu acesso não permite visualizar valores"><Lock size={11} /> Restrito</span>
        )}
      </div>
      {error && <p className="mt-1 text-[10px] text-rose-300">{error}</p>}
    </div>
  )
}
