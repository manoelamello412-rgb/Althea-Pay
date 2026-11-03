'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Mail, MessageCircle, Paperclip, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { hasOrganizationCapability, loadOrganizationAccess, type OrganizationAccess } from '@/lib/auth/organization-access'
import { CrmMessageAttachment } from '@/components/crm-message-attachment'

type Receipt = { id: string; bucket: string; path: string; file_name: string | null; mime_type: string | null; created_at: string; transaction_id?: string | null }
type Detail = { checkout: Record<string, unknown>; transactions: Record<string, unknown>[] }

const LABELS: Record<string, string> = {
  name: 'Nome', full_name: 'Nome', nome: 'Nome', email: 'E-mail', phone: 'Telefone', telefone: 'Telefone', whatsapp: 'WhatsApp',
  phone_e164: 'Telefone', cpf: 'CPF', document: 'Documento', document_number: 'Documento', tax_id: 'CPF/CNPJ', address: 'Endereço',
  endereco: 'Endereço', zip: 'CEP', zipcode: 'CEP', cep: 'CEP', city: 'Cidade', cidade: 'Cidade', state: 'Estado', uf: 'Estado',
  street: 'Rua', number: 'Número', complement: 'Complemento', neighborhood: 'Bairro', bairro: 'Bairro', country: 'País',
}
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

// Flattens nested objects (address) into "Endereço · Rua" style rows; skips empty values.
function fields(customer: Record<string, unknown>, prefix = ''): [string, string][] {
  return Object.entries(customer).flatMap(([key, value]): [string, string][] => {
    const label = (prefix ? `${prefix} · ` : '') + (LABELS[key.toLowerCase()] ?? key.replace(/_/g, ' '))
    if (value && typeof value === 'object' && !Array.isArray(value)) return fields(value as Record<string, unknown>, label)
    const text = Array.isArray(value) ? value.join(', ') : value == null ? '' : String(value).trim()
    return text ? [[label, text]] : []
  })
}

export function CheckoutDetail({ checkoutId, transactionId, onClose, onRemarketing, canRemarket }: {
  checkoutId: string
  transactionId: string | null
  onClose: () => void
  onRemarketing: (channel: 'email' | 'whatsapp') => void
  canRemarket: boolean
}) {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [access, setAccess] = useState<OrganizationAccess | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const canView = hasOrganizationCapability(access, 'can_view_chats') && hasOrganizationCapability(access, 'can_view_values')
  const canAttach = hasOrganizationCapability(access, 'can_reply_chats') && hasOrganizationCapability(access, 'can_view_values')

  const load = useCallback(async () => {
    setError('')
    try {
      const [current, detailResult, receiptResult, txResult] = await Promise.all([
        loadOrganizationAccess(db),
        db.rpc('checkout_operations_detail_v1', { p_checkout_id: checkoutId }),
        db.from('checkout_receipts').select('id,bucket,path,file_name,mime_type,created_at,transaction_id').eq('checkout_id', checkoutId).order('created_at', { ascending: false }),
        transactionId ? db.rpc('transaction_detail_v1', { p_transaction_id: transactionId }) : Promise.resolve({ data: null, error: null }),
      ])
      if (detailResult.error) throw detailResult.error
      setAccess(current)
      setDetail(detailResult.data as Detail)
      // Manual receipts + the ones the buyer sent in the chat for this transaction.
      const chat = (record(txResult.data).receipts as Array<Record<string, unknown>> | undefined ?? []).map((item) => ({
        id: String(item.message_id), bucket: String(item.bucket), path: String(item.path), file_name: (item.file_name as string) ?? null,
        mime_type: (item.mime_type as string) ?? null, created_at: String(item.created_at),
      }))
      setReceipts([...((receiptResult.data ?? []) as Receipt[]), ...chat])
    } catch {
      setError('Não foi possível carregar o checkout.')
    }
  }, [db, checkoutId, transactionId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function attach(file: File) {
    if (!access) return
    if (!ACCEPT.includes(file.type)) { setError('Envie JPG, PNG, WEBP ou PDF.'); return }
    if (file.size > 4 * 1024 * 1024) { setError('O comprovante pode ter no máximo 4 MB.'); return }
    setUploading(true); setError('')
    const ext = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1]
    const path = `${access.organization_id}/checkouts/${checkoutId}/${crypto.randomUUID()}.${ext}`
    const upload = await db.storage.from('chat-attachments').upload(path, file, { contentType: file.type })
    const linked = upload.error ? upload : await db.rpc('checkout_receipt_attach_v1', { p_checkout_id: checkoutId, p_path: path, p_mime_type: file.type, p_size_bytes: file.size, p_file_name: file.name })
    setUploading(false)
    if (linked.error) { setError('Não foi possível anexar o comprovante.'); return }
    await load()
  }

  const checkout = record(detail?.checkout)
  const customer = fields(record(checkout.customer))

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label="Detalhes do checkout" onClick={(event) => event.stopPropagation()} className="h-full w-full max-w-lg overflow-y-auto border-l border-white/10 bg-[#0b0f0d] p-5 text-sm text-zinc-200">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div><p className="text-[11px] font-bold tracking-[0.22em] text-[var(--althea-brand)]">CHECKOUT</p><p className="mt-1 font-mono text-xs text-[var(--althea-muted)]">{checkoutId}</p></div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-lg p-1.5 hover:bg-white/[0.06]"><X size={18} /></button>
        </div>
        {error && <div role="alert" className="mb-4 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-rose-200">{error}</div>}
        {!detail ? <div className="flex items-center gap-2 text-[var(--althea-muted)]"><Loader2 size={16} className="animate-spin" /> Carregando</div> : <>
          <section className="mb-6">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-[var(--althea-muted)]">Dados do cliente</h2>
            {customer.length ? <dl className="divide-y divide-white/[0.05] rounded-xl border border-white/[0.07]">
              {customer.map(([label, value], index) => <div key={index} className="flex gap-3 px-3 py-2"><dt className="w-36 shrink-0 capitalize text-[var(--althea-muted)]">{label}</dt><dd className="min-w-0 break-words text-white">{value}</dd></div>)}
            </dl> : <p className="text-[var(--althea-muted)]">O cliente não preencheu dados.</p>}
            <p className="mt-2 text-xs text-[var(--althea-muted)]">Funil: {String(checkout.funnel_name ?? checkout.funnel_id ?? '—')} · Produto: {String(checkout.product_name ?? checkout.product_id ?? '—')}</p>
          </section>

          {canRemarket && <section className="mb-6 flex gap-2">
            <button type="button" onClick={() => onRemarketing('email')} className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 px-3 hover:bg-white/[0.06]"><Mail size={15} /> Remarketing por e-mail</button>
            <button type="button" onClick={() => onRemarketing('whatsapp')} className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 px-3 hover:bg-white/[0.06]"><MessageCircle size={15} /> Remarketing por WhatsApp</button>
          </section>}

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--althea-muted)]">Comprovantes</h2>
              {canAttach && <label className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-xs hover:bg-white/[0.06] ${uploading ? 'pointer-events-none opacity-50' : ''}`}>
                {uploading ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />} Anexar comprovante
                <input type="file" accept={ACCEPT.join(',')} className="sr-only" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void attach(file) }} />
              </label>}
            </div>
            {!canView ? <p className="text-[var(--althea-muted)]">Ver comprovantes exige permissão de chats e valores.</p>
              : receipts.length ? receipts.map((receipt) => <CrmMessageAttachment key={receipt.id} canView metadata={{ attachment: { kind: 'transfer_receipt', bucket: receipt.bucket, path: receipt.path, file_name: receipt.file_name, mime_type: receipt.mime_type } }} />)
                : <p className="text-[var(--althea-muted)]">Nenhum comprovante.</p>}
          </section>
        </>}
      </aside>
    </div>
  )
}
