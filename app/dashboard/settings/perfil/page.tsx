'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowLeft, Building2, Check, Mail, Save, ShieldCheck, UserRound } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type ProfileRecord = {
  id: string
  display_name: string | null
  full_name: string | null
  avatar_url: string | null
  updated_at: string
}

type BusinessProfileRecord = {
  document_type: string | null
  document_number: string | null
  legal_name: string | null
}

const AVATAR_PRESETS = [
  { id: 'althea-01', label: 'Preset 01', url: 'https://api.dicebear.com/9.x/notionists/svg?seed=Althea-01' },
  { id: 'althea-02', label: 'Preset 02', url: 'https://api.dicebear.com/9.x/notionists/svg?seed=Althea-02' },
  { id: 'althea-03', label: 'Preset 03', url: 'https://api.dicebear.com/9.x/notionists/svg?seed=Althea-03' },
  { id: 'althea-04', label: 'Preset 04', url: 'https://api.dicebear.com/9.x/notionists/svg?seed=Althea-04' },
]

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map(part => part[0]?.toUpperCase()).join('') || 'AP'
}

function maskDocument(value: string | null) {
  if (!value) return 'Não cadastrado'
  const clean = value.replace(/\s/g, '')
  if (clean.length <= 4) return '••••'
  return `${'•'.repeat(Math.max(0, clean.length - 4))}${clean.slice(-4)}`
}

export default function PerfilSettingsPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [profile, setProfile] = useState<ProfileRecord | null>(null)
  const [business, setBusiness] = useState<BusinessProfileRecord | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    async function loadProfile() {
      setLoading(true)
      setError('')
      try {
        const { data: userData, error: userError } = await db.auth.getUser()
        if (userError || !userData.user) {
          router.replace('/login')
          return
        }
        const user = userData.user
        const [profileResult, businessResult] = await Promise.all([
          db.from('profiles').select('id,display_name,full_name,avatar_url,updated_at').eq('id', user.id).maybeSingle(),
          db.from('merchant_business_profiles').select('document_type,document_number,legal_name').eq('user_id', user.id).maybeSingle(),
        ])
        if (!mounted) return
        if (profileResult.error && profileResult.error.code !== 'PGRST116') throw profileResult.error
        if (businessResult.error && businessResult.error.code !== 'PGRST116') throw businessResult.error

        const metadata = user.user_metadata ?? {}
        const resolvedName = String(profileResult.data?.display_name ?? profileResult.data?.full_name ?? metadata.display_name ?? metadata.full_name ?? metadata.name ?? '')
        setProfile(profileResult.data as ProfileRecord | null)
        setBusiness(businessResult.data as BusinessProfileRecord | null)
        setName(resolvedName)
        setEmail(user.email ?? '')
        setPhone(user.phone ?? '')
        setAvatarUrl(String(profileResult.data?.avatar_url ?? metadata.avatar_url ?? metadata.picture ?? ''))
      } catch (cause) {
        if (mounted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o perfil.')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void loadProfile()
    return () => { mounted = false }
  }, [db, router])

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const { data: userData, error: userError } = await db.auth.getUser()
      const user = userData.user
      if (userError || !user) throw new Error(userError?.message || 'Sessão não encontrada.')
      const cleanName = name.trim()
      if (!cleanName) throw new Error('Informe o nome de exibição.')

      const nextMetadata = {
        ...user.user_metadata,
        display_name: cleanName,
        full_name: cleanName,
        name: cleanName,
        avatar_url: avatarUrl || null,
      }

      const { error: authUpdateError } = await db.auth.updateUser({ data: nextMetadata })
      if (authUpdateError) throw authUpdateError

      const { data: savedProfile, error: profileError } = await db
        .from('profiles')
        .upsert({
          id: user.id,
          display_name: cleanName,
          full_name: cleanName,
          avatar_url: avatarUrl || null,
          updated_at: new Date().toISOString(),
        })
        .select('id,display_name,full_name,avatar_url,updated_at')
        .single()
      if (profileError) throw profileError

      setProfile(savedProfile as ProfileRecord)
      setMessage('Perfil atualizado com sucesso.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar as alterações.')
    } finally {
      setSaving(false)
    }
  }

  if (loading && !profile && !email) {
    return <div className="min-h-64 animate-pulse rounded-2xl border border-[#191921] bg-[#0B0B0F]" />
  }

  const displayName = name || 'Meu Perfil'
  const documentLabel = business?.document_type || 'CPF/CNPJ'

  return (
    <div className="min-h-full bg-[#060608] pb-32 font-['Space_Grotesk'] text-zinc-100">
      <div className="mb-5 border-b border-[#191921] pb-4">
        <button type="button" onClick={() => router.push('/dashboard/settings')} className="inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-zinc-400 hover:text-white">
          <ArrowLeft size={15} /> Voltar
        </button>
      </div>

      <main className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <form onSubmit={handleSave} className="space-y-5">
          <section className="rounded-2xl border border-[#191921] bg-[#0B0B0F] p-5">
            <div className="flex items-center gap-4">
              <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border border-[#1DB854]/30 bg-[#060608] text-lg font-bold text-[#1DB854]">
                {avatarUrl ? <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" onError={() => setAvatarUrl('')} /> : initials(displayName)}
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold tracking-tight text-white">Meu Perfil</h1>
                <p className="truncate text-xs text-zinc-400">{displayName}</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-[#191921] bg-[#0B0B0F] p-5">
            <div className="mb-4 flex items-center gap-2"><UserRound size={16} className="text-[#1DB854]" /><h2 className="text-sm font-semibold text-white">Identidade</h2></div>
            <div className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Nome de exibição</span>
                <input required maxLength={100} value={name} onChange={event => setName(event.target.value)} className="min-h-11 w-full rounded-xl border border-[#191921] bg-[#060608] px-3 text-sm text-white outline-none focus:border-[#1DB854]/50" />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">E-mail de login</span>
                <div className="relative"><Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" /><input value={email} readOnly aria-readonly="true" className="min-h-11 w-full cursor-not-allowed rounded-xl border border-[#191921] bg-[#060608] pl-9 pr-3 text-sm text-zinc-500 outline-none" /></div>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Telefone</span><input value={phone || 'Não cadastrado'} readOnly className="min-h-11 w-full cursor-not-allowed rounded-xl border border-[#191921] bg-[#060608] px-3 text-sm text-zinc-500 outline-none" /></label>
                <label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{documentLabel}</span><input value={maskDocument(business?.document_number ?? null)} readOnly className="min-h-11 w-full cursor-not-allowed rounded-xl border border-[#191921] bg-[#060608] px-3 font-mono text-sm text-zinc-500 outline-none" /></label>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-[#191921] bg-[#0B0B0F] p-5">
            <div className="mb-4 flex items-center gap-2"><UserRound size={16} className="text-[#1DB854]" /><h2 className="text-sm font-semibold text-white">Avatar</h2></div>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {AVATAR_PRESETS.map(preset => (
                <button key={preset.id} type="button" aria-label={preset.label} onClick={() => setAvatarUrl(preset.url)} className={`h-12 w-12 shrink-0 overflow-hidden rounded-full border-2 bg-[#060608] p-0.5 ${avatarUrl === preset.url ? 'border-[#1DB854]' : 'border-[#191921] hover:border-zinc-600'}`}>
                  <img src={preset.url} alt="" className="h-full w-full rounded-full object-cover" />
                </button>
              ))}
            </div>
          </section>

          {error && <div className="rounded-xl border border-rose-900/40 bg-rose-950/20 p-3 text-xs text-rose-300" role="alert">{error}</div>}
          {message && <div className="flex items-center gap-2 rounded-xl border border-[#1DB854]/20 bg-[#1DB854]/5 p-3 text-xs text-[#1DB854]" role="status"><Check size={15} />{message}</div>}

          <button type="submit" disabled={saving} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#1DB854] px-4 text-sm font-bold text-[#060608] disabled:opacity-60">
            <Save size={15} /> {saving ? 'Salvando…' : 'Salvar perfil'}
          </button>
        </form>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-[#191921] bg-[#0B0B0F] p-5">
            <div className="flex items-center gap-2"><Building2 size={16} className="text-[#1DB854]" /><h2 className="text-sm font-semibold text-white">Empresa</h2></div>
            <p className="mt-3 text-xs text-zinc-500">{business?.legal_name || 'Cadastro empresarial não preenchido.'}</p>
            <button type="button" onClick={() => router.push('/dashboard/settings/empresa')} className="mt-4 min-h-11 w-full rounded-xl border border-[#191921] text-xs font-semibold text-zinc-300 hover:text-white">Abrir Minha Empresa</button>
          </section>
          <section className="rounded-2xl border border-[#191921] bg-[#0B0B0F] p-5">
            <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-[#1DB854]" /><h2 className="text-sm font-semibold text-white">Segurança</h2></div>
            <p className="mt-3 text-xs leading-5 text-zinc-500">Senha, MFA e sessões são administrados somente na área de Segurança.</p>
            <button type="button" onClick={() => router.push('/dashboard/security')} className="mt-4 min-h-11 w-full rounded-xl border border-[#191921] text-xs font-semibold text-zinc-300 hover:text-white">Abrir Segurança</button>
          </section>
        </aside>
      </main>
    </div>
  )
}
