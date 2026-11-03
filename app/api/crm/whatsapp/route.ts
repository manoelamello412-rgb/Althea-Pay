import { NextResponse } from 'next/server'
import { accountId, bridge, context, requestedAccount } from '@/lib/crm/whatsapp-bridge'

// Pairs a Baileys WhatsApp number (?account=<id>): by QR code, or by pairing code when POST gets { phone }.
// POST without ?account creates a new Baileys number. It stays inactive until the bridge reports "connected".

export async function GET(request: Request) {
  const supabase = await context()
  if (!supabase) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const id = await accountId(supabase, requestedAccount(request))
  if (!id) return NextResponse.json({ status: 'disconnected', qr: null, phone: null })
  const res = await bridge(`/instances/${id}`)
  if (!res.ok) return res
  const state = await res.json() as { status?: string; phone?: string | null }
  if (state.status === 'connected') await supabase.rpc('crm_whatsapp_mark_paired', { p_account_id: id, p_phone: state.phone ?? null })
  return NextResponse.json({ ...state, account_id: id })
}

export async function POST(request: Request) {
  const supabase = await context()
  if (!supabase) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { phone: raw, name } = await request.json().catch(() => ({})) as { phone?: unknown; name?: unknown }
  let phone = typeof raw === 'string' ? raw.replace(/\D/g, '') : ''
  // Bare 10–11 digit phones are Brazilian (DDD + number).
  if (phone.length === 10 || phone.length === 11) phone = '55' + phone
  if (raw !== undefined && !/^\d{12,15}$/.test(phone)) return NextResponse.json({ error: 'INVALID_PHONE' }, { status: 400 })

  const requested = requestedAccount(request)
  let id = requested ? await accountId(supabase, requested) : undefined
  if (requested && !id) return NextResponse.json({ error: 'CHANNEL_ACCOUNT_NOT_FOUND' }, { status: 404 })
  if (!id) {
    const { data, error } = await supabase.rpc('crm_whatsapp_configure', { p_provider: 'baileys', p_display_name: typeof name === 'string' ? name : null })
    id = (data as { id?: string } | null)?.id
    if (error || !id) return NextResponse.json({ error: error?.message === 'FORBIDDEN' ? 'FORBIDDEN' : 'WHATSAPP_ACCOUNT_FAILED' }, { status: error?.message === 'FORBIDDEN' ? 403 : 500 })
  }
  const res = await bridge(`/instances/${id}/start`, 'POST', phone ? { phone } : {})
  if (!res.ok) return res
  return NextResponse.json({ ...(await res.json()), account_id: id })
}

// Disconnects the bridge session and pauses the number, so nothing is sent or received through it.
export async function DELETE(request: Request) {
  const supabase = await context()
  if (!supabase) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const id = await accountId(supabase, requestedAccount(request))
  if (!id) return NextResponse.json({ status: 'disconnected' })
  const res = await bridge(`/instances/${id}`, 'DELETE')
  const { data: account } = await supabase.from('crm_channel_accounts').select('display_name').eq('id', id).maybeSingle()
  await supabase.rpc('crm_channel_account_update', { p_id: id, p_display_name: account?.display_name ?? null, p_status: 'inactive' })
  return res
}
