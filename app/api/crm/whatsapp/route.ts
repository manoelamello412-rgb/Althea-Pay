import { NextResponse } from 'next/server'
import { accountId, bridge, context } from '@/lib/crm/whatsapp-bridge'

// Pairs the organization's WhatsApp when its provider is Baileys: by QR code, or by pairing code when
// POST gets { phone }.

export async function GET() {
  const supabase = await context()
  if (!supabase) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const id = await accountId(supabase)
  return id ? bridge(`/instances/${id}`) : NextResponse.json({ status: 'disconnected', qr: null, phone: null })
}

export async function POST(request: Request) {
  const supabase = await context()
  if (!supabase) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { phone: raw } = await request.json().catch(() => ({})) as { phone?: unknown }
  let phone = typeof raw === 'string' ? raw.replace(/\D/g, '') : ''
  // Bare 10–11 digit phones are Brazilian (DDD + number).
  if (phone.length === 10 || phone.length === 11) phone = '55' + phone
  if (raw !== undefined && !/^\d{12,15}$/.test(phone)) return NextResponse.json({ error: 'INVALID_PHONE' }, { status: 400 })
  const { data, error } = await supabase.rpc('crm_whatsapp_configure', { p_provider: 'baileys' })
  const id = (data as { id?: string } | null)?.id
  if (error || !id) return NextResponse.json({ error: error?.message === 'FORBIDDEN' ? 'FORBIDDEN' : 'WHATSAPP_ACCOUNT_FAILED' }, { status: error?.message === 'FORBIDDEN' ? 403 : 500 })
  return bridge(`/instances/${id}/start`, 'POST', phone ? { phone } : {})
}

export async function DELETE() {
  const supabase = await context()
  if (!supabase) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const id = await accountId(supabase)
  return id ? bridge(`/instances/${id}`, 'DELETE') : NextResponse.json({ status: 'disconnected' })
}
