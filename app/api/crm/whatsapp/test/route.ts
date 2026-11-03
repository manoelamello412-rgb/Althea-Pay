import { NextResponse } from 'next/server'
import { context, requestedAccount } from '@/lib/crm/whatsapp-bridge'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { infobipTemplatesUrl } from '@/supabase/functions/_shared/infobip'
import { infobipTestResult } from '@/lib/crm/infobip-test'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const supabase = await context()
  if (!supabase) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const id = requestedAccount(request)
  if (!id) return NextResponse.json({ error: 'CHANNEL_ACCOUNT_NOT_FOUND' }, { status: 404 })
  // RLS: only visible with can_manage_integrations in the caller's organization.
  const { data: account } = await supabase.from('crm_channel_accounts').select('id,provider,external_account_id,metadata').eq('id', id).maybeSingle()
  if (!account || account.provider !== 'infobip') return NextResponse.json({ error: 'CHANNEL_ACCOUNT_NOT_FOUND' }, { status: 404 })

  const { data: credentials } = await createSupabaseAdminClient().rpc('crm_channel_account_credentials', { p_account_id: id })
  const creds = (credentials ?? {}) as Record<string, unknown>
  const metadata = (account.metadata ?? {}) as Record<string, unknown>
  const apiKey = String(creds.api_key ?? creds.access_token ?? '')
  const baseUrl = String(creds.base_url ?? metadata.base_url ?? '')
  const from = String(metadata.from_number ?? account.external_account_id ?? '')
  if (!apiKey || !baseUrl || !from) return NextResponse.json({ ok: false, message: 'Falta a URL base, a API key ou o número. Preencha e salve antes de testar.' })

  let status: number | null = null
  try {
    const response = await fetch(infobipTemplatesUrl(baseUrl, from), { headers: { authorization: `App ${apiKey}`, accept: 'application/json' }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) })
    status = response.status
  } catch {
    status = null
  }
  return NextResponse.json(infobipTestResult(status))
}
