import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { requestedAccount } from '@/lib/crm/whatsapp-bridge'
import { emailHtml } from '@/supabase/functions/_shared/remarketing'

export const dynamic = 'force-dynamic'

// Sends a real e-mail to the signed-in user: proves the key, the verified domain and the sender in one go.
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const id = requestedAccount(request)
  if (!id) return NextResponse.json({ error: 'CHANNEL_ACCOUNT_NOT_FOUND' }, { status: 404 })
  // RLS: only visible with can_manage_integrations in the caller's organization.
  const { data: account } = await supabase.from('crm_channel_accounts').select('id,channel,provider,metadata').eq('id', id).maybeSingle()
  if (!account || account.channel !== 'email' || account.provider !== 'resend') return NextResponse.json({ error: 'CHANNEL_ACCOUNT_NOT_FOUND' }, { status: 404 })

  const { data: credentials } = await createSupabaseAdminClient().rpc('crm_channel_account_credentials', { p_account_id: id })
  const apiKey = String((credentials as Record<string, unknown> | null)?.api_key ?? '')
  const metadata = (account.metadata ?? {}) as Record<string, string | undefined>
  if (!apiKey || !metadata.from_email) return NextResponse.json({ ok: false, message: 'Falta o remetente ou a API key. Preencha e salve antes de testar.' })
  const from = metadata.from_name ? `${metadata.from_name} <${metadata.from_email}>` : metadata.from_email
  const body = 'Este é um e-mail de teste da Althea Pay. Se chegou, o remarketing por e-mail está pronto.'

  let response: Response
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [user.email], subject: 'Teste de envio · Althea Pay', text: body, html: emailHtml(body), ...(metadata.reply_to ? { reply_to: metadata.reply_to } : {}) }),
      cache: 'no-store', signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return NextResponse.json({ ok: false, message: 'A Resend não respondeu. Tente de novo em instantes.' })
  }
  if (response.ok) return NextResponse.json({ ok: true, message: `Enviado para ${user.email}. Confira a caixa de entrada (e o spam).` })
  const detail = String(((await response.json().catch(() => ({}))) as { message?: unknown }).message ?? '')
  const message = response.status === 401 || (response.status === 403 && /api key/i.test(detail)) ? 'A Resend recusou a API key. Gere outra com permissão de envio.'
    : response.status === 403 || /domain/i.test(detail) ? `O domínio de ${metadata.from_email} não está verificado na Resend. Verifique em resend.com/domains.`
    : response.status === 422 ? `A Resend recusou o envio: ${detail || 'dados inválidos'}.`
    : response.status === 429 ? 'Limite de envios da Resend atingido. Tente mais tarde.'
    : `A Resend respondeu ${response.status}${detail ? `: ${detail}` : ''}.`
  return NextResponse.json({ ok: false, message })
}
