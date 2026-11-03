import { NextResponse } from 'next/server'
import { accountId, bridge, context, requestedAccount } from '@/lib/crm/whatsapp-bridge'

// Lead extractor (Baileys only: Infobip has no access to groups).
// GET ?account=                      -> groups and communities of that number
// GET ?account=&group=<jid>          -> participants of a group, with "already a client" flags
// GET ?account=&community=<jid>      -> participants of every group of a community, without repeats
// POST { name, contacts: [{ phone, name }] } -> imports the chosen participants as leads, in a list named after the group

const JID = /^[\d-]+@g\.us$/
type Member = { phone: string; name: string | null }

export async function GET(request: Request) {
  const supabase = await context()
  if (!supabase) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const id = await accountId(supabase, requestedAccount(request))
  if (!id) return NextResponse.json({ error: 'WHATSAPP_NOT_CONNECTED' }, { status: 409 })

  const params = new URL(request.url).searchParams
  const group = params.get('group'), community = params.get('community')
  if (!group && !community) return bridge(`/instances/${id}/groups`)
  const target = group ?? community ?? ''
  if (!JID.test(target)) return NextResponse.json({ error: 'INVALID_GROUP' }, { status: 400 })

  const res = await bridge(`/instances/${id}/${group ? 'groups' : 'communities'}/${encodeURIComponent(target)}`)
  if (!res.ok) return res
  const data = await res.json() as { name: string; members: Member[]; skipped: number; groups?: unknown[] }
  const { data: known } = await supabase.rpc('crm_whatsapp_known_phones', { p_phones: data.members.slice(0, 5000).map(m => m.phone) })
  const knownSet = new Set((known ?? []) as string[])
  return NextResponse.json({ ...data, members: data.members.map(m => ({ ...m, known: knownSet.has(m.phone) })) })
}

export async function POST(request: Request) {
  const supabase = await context()
  if (!supabase) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { name?: unknown; contacts?: unknown }
  const contacts = Array.isArray(body.contacts)
    ? body.contacts.flatMap(c => {
        const phone = typeof c?.phone === 'string' ? c.phone.replace(/\D/g, '') : ''
        return /^\d{8,15}$/.test(phone) ? [{ phone, name: typeof c?.name === 'string' ? c.name.slice(0, 120) : null }] : []
      })
    : []
  if (!contacts.length || contacts.length > 5000) return NextResponse.json({ error: 'INVALID_CONTACTS' }, { status: 400 })

  const { data, error } = await supabase.rpc('crm_whatsapp_import_contacts', { p_group_name: typeof body.name === 'string' ? body.name : '', p_contacts: contacts })
  if (error) return NextResponse.json({ error: error.message === 'FORBIDDEN' ? 'FORBIDDEN' : 'IMPORT_FAILED' }, { status: error.message === 'FORBIDDEN' ? 403 : 500 })
  const result = data as { imported: number; new: number; list_name: string | null }
  return NextResponse.json({ imported: result.imported, new: result.new, list: result.list_name })
}
