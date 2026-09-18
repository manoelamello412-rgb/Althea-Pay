'use client'

import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, ShieldCheck, UsersRound } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type MemberRole = 'owner' | 'admin' | 'manager' | 'operator' | 'supervisor' | 'viewer'
type Membership = { organization_id: string; user_id: string; role: MemberRole; created_at: string }
type Organization = { id: string; name: string; slug: string }
type Profile = { id: string; display_name: string | null; avatar_url: string | null }

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

  async function load(): Promise<void> {
    setError('')
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) {
      router.replace('/login')
      return
    }
    setCurrentUserId(auth.user.id)

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
    <div className="w-full space-y-5">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Administração</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">Membros e acessos</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--althea-muted)]">Visão dos membros e papéis realmente vinculados às organizações acessíveis pela sua sessão.</p>
        </div>
        <button onClick={() => void refresh()} disabled={refreshing || loading} className="inline-flex h-10 items-center gap-2 self-start rounded-xl border border-white/[.06] bg-[var(--althea-surface)] px-4 text-[10px] font-semibold text-[var(--althea-muted)] transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50 lg:self-auto">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="min-h-[112px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4"><p className="text-xs text-[var(--althea-muted)]">Membros</p><p className="mt-2 text-2xl font-semibold">{memberships.length}</p></div>
          <div className="min-h-[112px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4"><p className="text-xs text-[var(--althea-muted)]">Organizações</p><p className="mt-2 text-2xl font-semibold">{organizationCount}</p></div>
          <div className="min-h-[112px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4"><p className="text-xs text-[var(--althea-muted)]">Owners / admins</p><p className="mt-2 text-2xl font-semibold">{ownerCount + adminCount}</p></div>
        </section>

        <section className="min-h-[112px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por membro, organização ou papel..." className="h-11 w-full rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/25" />
        </section>

        {error && <section className="rounded-2xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-200">{error}</section>}

        <section className="overflow-hidden rounded-2xl border border-white/[.055] bg-[var(--althea-surface)]">
          <div className="hidden grid-cols-[1.4fr_1.2fr_.8fr_1fr] gap-4 border-b border-white/[.055] px-5 py-3 text-[11px] font-medium uppercase tracking-wider text-[var(--althea-muted)] md:grid">
            <span>Membro</span><span>Organização</span><span>Papel</span><span>Vínculo</span>
          </div>
          {loading ? (
            <div className="p-8 text-sm text-[var(--althea-muted)]">Carregando acessos reais...</div>
          ) : filteredMemberships.length === 0 ? (
            <div className="p-8 text-sm text-[var(--althea-muted)]">Nenhum vínculo encontrado para os filtros atuais.</div>
          ) : (
            <div className="divide-y divide-white/10">
              {filteredMemberships.map((membership) => {
                const profile = profiles[membership.user_id]
                const organization = organizationMap[membership.organization_id]
                const isCurrent = membership.user_id === currentUserId
                return (
                  <div key={`${membership.organization_id}:${membership.user_id}`} className="grid gap-3 px-5 py-4 md:grid-cols-[1.4fr_1.2fr_.8fr_1fr] md:items-center">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[.055] bg-white/[0.06] text-xs font-semibold text-white/70">{(profile?.display_name ?? membership.user_id).slice(0, 2).toUpperCase()}</div>
                        <div className="min-w-0"><p className="truncate text-sm font-medium">{profile?.display_name || 'Membro sem nome'}</p><p className="truncate text-xs text-[var(--althea-muted)]">{membership.user_id}</p></div>
                      </div>
                      {isCurrent && <span className="mt-2 inline-flex rounded-full border border-white/[.055] px-2 py-0.5 text-[10px] text-white/55">Sessão atual</span>}
                    </div>
                    <div><p className="text-sm text-white/75">{organization?.name || 'Organização'}</p><p className="text-xs text-[var(--althea-muted)]">{organization?.slug || membership.organization_id}</p></div>
                    <div><span className="inline-flex rounded-full border border-white/[.055] bg-white/[0.04] px-2.5 py-1 text-xs text-white/70">{roleLabel[membership.role]}</span></div>
                    <div className="text-xs text-[var(--althea-muted)]">{new Date(membership.created_at).toLocaleDateString('pt-BR')}</div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="flex gap-3 rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 text-sm text-white/50">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-white/60" />
          <p>O controle de acesso permanece vinculado ao modelo de membros e RLS da organização. Esta tela não inventa convites, alteração de papel ou permissões que ainda não estejam expostos por uma operação segura do backend.</p>
        </section>
    </div>
  )
}
