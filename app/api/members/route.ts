import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

// Owner/admin creates members directly (email + password, no invite email), changes their role or removes them.
// Scope is always the actor's current organization (organization_my_access_v1). The auth trigger
// triggers (bootstrap_user_tenant / join_member_org_from_app_metadata) put the new user in that org via app_metadata.
const ASSIGNABLE = ['admin', 'manager', 'operator', 'supervisor', 'viewer', 'attendant']
const UUID = /^[0-9a-f-]{36}$/i

type Access = { organization_id: string; user_id: string; role: string; capabilities: Record<string, boolean> }

async function actor(requireManage = true) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) }
  const { data, error } = await supabase.rpc('organization_my_access_v1')
  const access = data as Access | null
  if (error || !access || (requireManage && !access.capabilities?.can_manage_members)) return { error: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }) }
  return { access, supabase }
}

// Names and e-mails of the current org's members: profiles RLS only exposes each user's own row.
export async function GET() {
  const { access, error } = await actor(false)
  if (error) return error
  const admin = createSupabaseAdminClient()
  const { data: rows } = await admin.from('organization_members').select('user_id').eq('organization_id', access.organization_id)
  const ids = (rows ?? []).map((row) => row.user_id as string)
  const { data: profiles } = await admin.from('profiles').select('id,display_name,full_name').in('id', ids)
  const users = await Promise.all(ids.map((id) => admin.auth.admin.getUserById(id)))
  const members = ids.map((id, index) => {
    const profile = profiles?.find((row) => row.id === id)
    return { user_id: id, name: profile?.display_name || profile?.full_name || null, email: users[index].data.user?.email ?? null }
  })
  return NextResponse.json({ organization_id: access.organization_id, members })
}

// Admins manage roles below admin; only the owner can grant admin.
function canAssign(actorRole: string, role: unknown): role is string {
  return typeof role === 'string' && ASSIGNABLE.includes(role) && (actorRole === 'owner' || role !== 'admin')
}

async function target(access: Access, userId: unknown) {
  if (typeof userId !== 'string' || !UUID.test(userId)) return { error: NextResponse.json({ error: 'INVALID_MEMBER' }, { status: 400 }) }
  if (userId === access.user_id) return { error: NextResponse.json({ error: 'SELF_CHANGE_FORBIDDEN' }, { status: 403 }) }
  const { data } = await createSupabaseAdminClient().from('organization_members').select('role').eq('organization_id', access.organization_id).eq('user_id', userId).maybeSingle()
  if (!data) return { error: NextResponse.json({ error: 'MEMBER_NOT_FOUND' }, { status: 404 }) }
  if (data.role === 'owner' || (data.role === 'admin' && access.role !== 'owner')) return { error: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }) }
  return { userId }
}

export async function POST(request: Request) {
  const { access, error } = await actor()
  if (error) return error
  const body = await request.json().catch(() => ({})) as { name?: unknown; email?: unknown; password?: unknown; role?: unknown }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'INVALID_MEMBER_DATA' }, { status: 400 })
  if (password.length < 8) return NextResponse.json({ error: 'PASSWORD_TOO_SHORT' }, { status: 400 })
  if (!canAssign(access.role, body.role)) return NextResponse.json({ error: 'INVALID_ROLE' }, { status: 400 })

  const created = await createSupabaseAdminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name, full_name: name },
    app_metadata: { althea_member_org: access.organization_id, althea_member_role: body.role },
  })
  if (created.error) {
    const exists = created.error.code === 'email_exists' || /already/i.test(created.error.message)
    return NextResponse.json({ error: exists ? 'EMAIL_ALREADY_REGISTERED' : created.error.message }, { status: exists ? 409 : 500 })
  }
  return NextResponse.json({ ok: true, user_id: created.data.user.id })
}

export async function PATCH(request: Request) {
  const { access, supabase, error } = await actor()
  if (error) return error
  const body = await request.json().catch(() => ({})) as { user_id?: unknown; role?: unknown }
  const t = await target(access, body.user_id)
  if (t.error) return t.error
  if (!canAssign(access.role, body.role)) return NextResponse.json({ error: 'INVALID_ROLE' }, { status: 400 })
  // User session, so RLS and enforce_organization_member_authority check the change too.
  const updated = await supabase.from('organization_members').update({ role: body.role }).eq('organization_id', access.organization_id).eq('user_id', t.userId)
  if (updated.error) return NextResponse.json({ error: updated.error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const { access, supabase, error } = await actor()
  if (error) return error
  const body = await request.json().catch(() => ({})) as { user_id?: unknown }
  const t = await target(access, body.user_id)
  if (t.error) return t.error
  const admin = createSupabaseAdminClient()
  const removed = await supabase.from('organization_members').delete().eq('organization_id', access.organization_id).eq('user_id', t.userId)
  if (removed.error) return NextResponse.json({ error: removed.error.message }, { status: 500 })

  // Point their default org at another membership; with none left, block the login (their data stays intact).
  const { data: rest } = await admin.from('organization_members').select('organization_id').eq('user_id', t.userId).order('created_at').limit(1)
  const next = rest?.[0]?.organization_id ?? null
  await admin.from('profiles').update({ default_organization_id: next }).eq('id', t.userId).eq('default_organization_id', access.organization_id)
  if (!next) await admin.auth.admin.updateUserById(t.userId, { ban_duration: '876000h' })
  return NextResponse.json({ ok: true })
}
