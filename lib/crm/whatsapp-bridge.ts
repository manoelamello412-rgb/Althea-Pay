import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { parseOrganizationAccess } from '@/lib/auth/organization-access'

// Shared by the /api/crm/whatsapp routes. Authorization is RLS: crm_channel_accounts is only visible
// with can_manage_integrations, and the RPCs check it too.

export async function bridge(path: string, method = 'GET', payload?: object) {
  const base = process.env.WHATSAPP_BRIDGE_URL?.replace(/\/$/, '')
  const token = process.env.WHATSAPP_BRIDGE_TOKEN
  if (!base || !token) return NextResponse.json({ error: 'WHATSAPP_BRIDGE_NOT_CONFIGURED' }, { status: 503 })
  try {
    const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, ...(payload && { 'content-type': 'application/json' }) }, body: payload && JSON.stringify(payload), cache: 'no-store', signal: AbortSignal.timeout(30_000) })
    const data = await res.json().catch(() => ({}))
    if (res.ok) return NextResponse.json(data)
    return NextResponse.json({ error: data?.error === 'whatsapp_not_connected' ? 'WHATSAPP_NOT_CONNECTED' : data?.error === 'invalid_phone' ? 'INVALID_PHONE' : 'WHATSAPP_BRIDGE_ERROR' }, { status: 502 })
  } catch {
    return NextResponse.json({ error: 'WHATSAPP_BRIDGE_UNREACHABLE' }, { status: 502 })
  }
}

export async function context() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user ? supabase : null
}

export async function accountId(supabase: NonNullable<Awaited<ReturnType<typeof context>>>) {
  const access = parseOrganizationAccess((await supabase.rpc('organization_my_access_v1', { p_organization_id: null })).data)
  if (!access) return undefined
  const { data } = await supabase.from('crm_channel_accounts').select('id').eq('organization_id', access.organization_id).eq('channel', 'whatsapp').eq('provider', 'baileys').maybeSingle()
  return data?.id as string | undefined
}
