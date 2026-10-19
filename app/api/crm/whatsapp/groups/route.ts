import { NextResponse } from 'next/server'
import { accountId, bridge, context } from '@/lib/crm/whatsapp-bridge'

// Lists the connected WhatsApp's groups (GET) and imports a group's participants as leads (POST { group_id }).

export async function GET() {
  const supabase = await context()
  if (!supabase) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const id = await accountId(supabase)
  return id ? bridge(`/instances/${id}/groups`) : NextResponse.json({ error: 'WHATSAPP_NOT_CONNECTED' }, { status: 409 })
}

export async function POST(request: Request) {
  const supabase = await context()
  if (!supabase) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { group_id: groupId } = await request.json().catch(() => ({})) as { group_id?: unknown }
  if (typeof groupId !== 'string' || !/^[\d-]+@g\.us$/.test(groupId)) return NextResponse.json({ error: 'INVALID_GROUP' }, { status: 400 })
  const id = await accountId(supabase)
  if (!id) return NextResponse.json({ error: 'WHATSAPP_NOT_CONNECTED' }, { status: 409 })

  const res = await bridge(`/instances/${id}/groups/${encodeURIComponent(groupId)}`)
  if (!res.ok) return res
  const group = await res.json() as { name: string; phones: string[]; skipped: number }
  if (group.phones.length === 0) return NextResponse.json({ imported: 0, skipped: group.skipped })

  const { data, error } = await supabase.rpc('crm_whatsapp_import_leads', { p_group_name: group.name, p_phones: group.phones.slice(0, 5000) })
  if (error) return NextResponse.json({ error: error.message === 'FORBIDDEN' ? 'FORBIDDEN' : 'IMPORT_FAILED' }, { status: error.message === 'FORBIDDEN' ? 403 : 500 })
  const result = data as { imported: number; list_name: string | null }
  return NextResponse.json({ imported: result.imported, list: result.list_name, skipped: group.skipped })
}
