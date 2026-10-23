'use client'

import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, ShieldCheck, Trash2, UserPlus, UsersRound } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type MemberRole = 'owner' | 'admin' | 'manager' | 'operator' | 'supervisor' | 'viewer'
type Membership = { organization_id: string; user_id: string; role: MemberRole; created_at: string }
type Organization = { id: string; name: string; slug: string }
type Profile = { id: string; display_name: string | null; avatar_url: string | null; email?: string | null }
type Access = { organization_id: string; role: MemberRole; capabilities: Record<string, boolean> }

const assignableRoles: MemberRole[] = ['admin', 'manager', 'operator', 'supervisor', 'viewer']
const errorLabel: Record<string, string> = {
  EMAIL_ALREADY_REGISTERED: 'Este e-mail já tem conta na Althea.',
  PASSWORD_TOO_SHORT: 'A senha precisa de pelo menos 8 caracteres.',
  INVALID_MEMBER_DATA: 'Informe nome e e-mail válidos.',
  INVALID_ROLE: 'Você não pode atribuir esse papel.',
  FORBIDDEN: 'Você não tem permissão para essa ação.',
  SELF_CHANGE_FORBIDDEN: 'Você não pode alterar o próprio acesso.',
}

function generatePassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  return Array.from(crypto.getRandomValues(new Uint32Array(12)), (n) => chars[n % chars.length]).join('')
}

const roleLabel: Record<MemberRole, string> = {
  owner: 'Proprietário',
  admin: 'Administrador',
  manager: 'Gestor',
  operator: 'Operador',
  supervisor: 'Supervisor',
  viewer: 'Visualizador',
}

export default function MembersPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const [currentUserId, setCurrentUserId] = useState('')
  const [search, setSearch] = useState('')
  const [access, setAccess] = useState<Access | null>(null)
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'operator' as MemberRole })
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  async function callMembers(method: 'POST' | 'PATCH' | 'DELETE', body: object): Promise<boolean> {
    setError('')
    setNotice('')
    const response = await fetch('/api/members', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) {
      setError(errorLabel[result.error ?? ''] ?? result.error ?? 'Não foi possível concluir a operação.')
      return false
    }
    await load().catch(() => null)
    return true
  }

  async function createMember(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setSaving(true)
    if (await callMembers('POST', form)) {
      setNotice(`Acesso criado. Envie ao membro: e-mail ${form.email} · senha ${form.password}`)
      setForm({ name: '', email: '', password: '', role: 'operator' })
    }
    setSaving(false)
  }

  async function removeMember(userId: string, name: string): Promise<void> {
    if (!window.confirm(`Remover o acesso de ${name} a esta organização?`)) return
    await callMembers('DELETE', { user_id: userId })
  }

  // Mirrors /api/members: never self, never the owner, and admins only touch roles below admin.
  function canManage(membership: Membership): boolean {
    if (!access?.capabilities.can_manage_members || membership.organization_id !== access.organization_id) return false
    if (membership.user_id === currentUserId || membership.role === 'owner') return false
    return access.role === 'owner' || membership.role !== 'admin'
  }
  const rolesForActor = assignableRoles.filter((role) => access?.role === 'owner' || role !== 'admin')

  async function load(): Promise<void> {
    setError('')
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) {
      router.replace('/login')
      return
    }
    setCurrentUserId(auth.user.id)

    const accessResult = await supabase.rpc('organization_my_access_v1')
    setAccess(accessResult.error ? null : accessResult.data as Access)

    const membershipResult = await supabase
      .from('organization_members')
      .select('organization_id,user_id,role,created_at')
      .order('created_at', { ascending: true })

    if (membershipResult.error) throw membershipResult.error
    const rows = (membershipResult.data ?? []) as Membership[]
    setMemberships(rows)

    const organizationIds = [...new Set(rows.map((row) => row.organization_id))]
    const userIds = [...new Set(rows.map((row) => row.user_id))]

    if (organizationIds.length) {
      const organizationsResult = await supabase
        .from('organizations')
        .select('id,name,slug')
        .in('id', organizationIds)
      if (organizationsResult.error) throw organizationsResult.error
      setOrganizations((organizationsResult.data ?? []) as Organization[])
    } else {
      setOrganizations([])
    }

    if (userIds.length) {
      const profilesResult = await supabase
        .from('profiles')
        .select('id,display_name,avatar_url')
        .in('id', userIds)
      if (profilesResult.error && profilesResult.error.code !== 'PGRST116') throw profilesResult.error
      const nextProfiles: Record<string, Profile> = {}
      for (const profile of (profilesResult.data ?? []) as Profile[]) nextProfiles[profile.id] = profile
      // Other members' profiles are hidden by RLS; the API fills in names/e-mails for the current org.
      const directory = await fetch('/api/members').then((response) => response.ok ? response.json() : null).catch(() => null) as { members: { user_id: string; name: string | null; email: string | null }[] } | null
      for (const member of directory?.members ?? []) {
        const own = nextProfiles[member.user_id]
        nextProfiles[member.user_id] = { id: member.user_id, avatar_url: own?.avatar_url ?? null, display_name: own?.display_name || member.name, email: member.email }
      }
      setProfiles(nextProfiles)
    } else {
      setProfiles({})
    }
  }

  useEffect(() => {
    let cancelled = false
    async function initialLoad(): Promise<void> {
      setLoading(true)
      try {
        await load()
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os membros.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void initialLoad()
    return () => { cancelled = true }
  }, [])

  async function refresh(): Promise<void> {
    setRefreshing(true)
    try {
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar os membros.')
    } finally {
      setRefreshing(false)
    }
  }

  const organizationMap = useMemo(() => Object.fromEntries(organizations.map((organization) => [organization.id, organization])), [organizations])
  const filteredMemberships = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return memberships
    return memberships.filter((membership) => {
      const organization = organizationMap[membership.organization_id]
      const profile = profiles[membership.user_id]
      const haystack = [
        organization?.name,
        organization?.slug,
        profile?.display_name,
        profile?.email,
        membership.user_id,
        roleLabel[membership.role],
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(term)
    })
  }, [memberships, organizationMap, profiles, search])

  const ownerCount = memberships.filter((member) => member.role === 'owner').length
  const adminCount = memberships.filter((member) => member.role === 'admin').length
  const organizationCount = organizations.length

  return (
    <main className="min-h-screen bg-[#07090d] px-4 pb-32 pt-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-white/45">
              <UsersRound className="h-4 w-4" /> Membros e acessos
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Acessos da organização</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">
              Visão operacional dos membros que possuem vínculo real com as organizações acessíveis pela sua sessão. Os papéis são provenientes do modelo de acesso persistido no banco.
            </p>
          </div>
          <button onClick={() => void refresh()} disabled={refreshing || loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-medium text-white/80 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        </header>

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><p className="text-xs text-white/45">Membros</p><p className="mt-2 text-2xl font-semibold">{memberships.length}</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><p className="text-xs text-white/45">Organizações</p><p className="mt-2 text-2xl font-semibold">{organizationCount}</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><p className="text-xs text-white/45">Owners / admins</p><p className="mt-2 text-2xl font-semibold">{ownerCount + adminCount}</p></div>
        </section>

        {access?.capabilities.can_manage_members && (
          <form onSubmit={(event) => void createMember(event)} className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <div className="flex items-center gap-2 text-sm font-medium"><UserPlus className="h-4 w-4 text-white/60" /> Criar acesso</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_.8fr_auto]">
              <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nome" className="h-11 rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/25" />
              <input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="E-mail" className="h-11 rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/25" />
              <div className="flex gap-2">
                <input required minLength={8} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Senha (mín. 8)" className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/25" />
                <button type="button" onClick={() => setForm({ ...form, password: generatePassword() })} className="h-11 shrink-0 rounded-xl border border-white/10 px-3 text-xs text-white/70 hover:bg-white/[0.08]">Gerar</button>
              </div>
              <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as MemberRole })} className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-white/25">
                {rolesForActor.map((role) => <option key={role} value={role} className="bg-[#07090d]">{roleLabel[role]}</option>)}
              </select>
              <button type="submit" disabled={saving} className="h-11 rounded-xl bg-white px-5 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-50">{saving ? 'Criando...' : 'Criar'}</button>
            </div>
          </form>
        )}

        {notice && <section className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-emerald-200">{notice}</section>}

        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por membro, organização ou papel..." className="h-11 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/25" />
        </section>

        {error && <section className="rounded-2xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-200">{error}</section>}

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
          <div className="hidden grid-cols-[1.4fr_1.2fr_.8fr_1fr] gap-4 border-b border-white/10 px-5 py-3 text-[11px] font-medium uppercase tracking-wider text-white/35 lg:grid">
            <span>Membro</span><span>Organização</span><span>Papel</span><span>Vínculo</span>
          </div>
          {loading ? (
            <div className="p-8 text-sm text-white/45">Carregando acessos reais...</div>
          ) : filteredMemberships.length === 0 ? (
            <div className="p-8 text-sm text-white/45">Nenhum vínculo encontrado para os filtros atuais.</div>
          ) : (
            <div className="divide-y divide-white/10">
              {filteredMemberships.map((membership) => {
                const profile = profiles[membership.user_id]
                const organization = organizationMap[membership.organization_id]
                const isCurrent = membership.user_id === currentUserId
                return (
                  <div key={`${membership.organization_id}:${membership.user_id}`} className="grid gap-3 px-5 py-4 lg:grid-cols-[1.4fr_1.2fr_.8fr_1fr] lg:items-center">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-xs font-semibold text-white/70">{(profile?.display_name ?? membership.user_id).slice(0, 2).toUpperCase()}</div>
                        <div className="min-w-0"><p className="truncate text-sm font-medium">{profile?.display_name || 'Membro sem nome'}</p><p className="truncate text-xs text-white/35">{profile?.email || membership.user_id}</p></div>
                      </div>
                      {isCurrent && <span className="mt-2 inline-flex rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/55">Sessão atual</span>}
                    </div>
                    <div><p className="text-sm text-white/75">{organization?.name || 'Organização'}</p><p className="text-xs text-white/35">{organization?.slug || membership.organization_id}</p></div>
                    <div>
                      {canManage(membership) ? (
                        <select value={membership.role} onChange={(event) => void callMembers('PATCH', { user_id: membership.user_id, role: event.target.value })} className="h-8 rounded-lg border border-white/10 bg-black/20 px-2 text-xs text-white/80 outline-none">
                          {rolesForActor.map((role) => <option key={role} value={role} className="bg-[#07090d]">{roleLabel[role]}</option>)}
                        </select>
                      ) : (
                        <span className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-white/70">{roleLabel[membership.role]}</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-white/40">
                      {new Date(membership.created_at).toLocaleDateString('pt-BR')}
                      {canManage(membership) && (
                        <button onClick={() => void removeMember(membership.user_id, profile?.display_name || 'este membro')} aria-label="Remover acesso" className="rounded-lg border border-white/10 p-1.5 text-white/50 hover:border-red-400/30 hover:text-red-300">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-sm text-white/50">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-white/60" />
          <p>Owners e administradores criam acessos com e-mail e senha, sem convite. O membro entra direto na organização com o papel escolhido. Administradores só gerenciam papéis abaixo de administrador; o proprietário não pode ser alterado.</p>
        </section>
      </div>
    </main>
  )
}
