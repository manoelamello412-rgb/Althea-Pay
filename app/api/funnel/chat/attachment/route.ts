import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { consumePublicRateLimit, retryAfterSeconds } from '@/lib/security/public-rate-limit'
import { RECEIPT_MAX_BYTES, receiptExtension, sniffReceiptType } from '@/lib/chat/receipt'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
}
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: cors })

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors })
}

export async function POST(req: NextRequest) {
  const declaredLength = Number(req.headers.get('content-length') ?? 0)
  if (declaredLength > RECEIPT_MAX_BYTES + 64 * 1024) return fail('file_too_large', 413)

  let form: FormData
  try { form = await req.formData() } catch { return fail('invalid_form', 400) }

  const token = String(form.get('conversation_token') ?? '').trim()
  if (token.length < 32 || token.length > 128) return fail('invalid_token', 400)
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) return fail('file_required', 400)
  if (file.size > RECEIPT_MAX_BYTES) return fail('file_too_large', 413)
  const caption = String(form.get('caption') ?? '').trim().slice(0, 1000) || null

  const admin = createSupabaseAdminClient()
  const rate = await consumePublicRateLimit(admin, req, 'chat-attachment', token, 5, 60)
  if (!rate.allowed) {
    if (rate.unavailable) return fail('chat_rate_limit_unavailable', 503)
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { ...cors, 'Retry-After': retryAfterSeconds(rate.resetAt) } })
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const mimeType = sniffReceiptType(bytes)
  if (!mimeType) return fail('invalid_file_type', 415)

  try {
    const target = await admin.rpc('crm_public_attachment_target', { p_token: token })
    if (target.error) return fail('conversation_unavailable', 503)
    const scope = target.data as { error?: string; conversation_id?: string; organization_id?: string }
    if (scope.error) return fail(scope.error, scope.error === 'not_found' ? 404 : 400)

    const path = `${scope.organization_id}/${scope.conversation_id}/${crypto.randomUUID()}.${receiptExtension(mimeType)}`
    const upload = await admin.storage.from('chat-attachments').upload(path, bytes, { contentType: mimeType, upsert: false })
    if (upload.error) return fail('upload_unavailable', 503)

    const message = await admin.rpc('crm_public_attachment_message', {
      p_token: token,
      p_path: path,
      p_mime_type: mimeType,
      p_size_bytes: bytes.byteLength,
      p_file_name: file.name || null,
      p_caption: caption,
    })
    const result = message.data as { error?: string } | null
    if (message.error || result?.error) {
      // No message points at the file, so it must not linger in storage.
      await admin.storage.from('chat-attachments').remove([path])
      if (message.error) return fail('message_unavailable', 503)
      return fail(result!.error!, 400)
    }
    return NextResponse.json(message.data, { status: 201, headers: cors })
  } catch {
    return fail('attachment_unavailable', 503)
  }
}
