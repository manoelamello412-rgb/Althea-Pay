'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowLeft, Check, Eye, EyeOff, KeyRound, LockKeyhole, Mail, Monitor, Save, ShieldCheck, UserRound } from 'lucide-react'
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

type SessionTelemetry = {
  ip: string | null
  isp: string | null
  location: string | null
}

const AVATAR_PRESETS = [
  { id: 'althea-01', label: 'Preset 01', url: 'https://api.dicebear.com/9.x/notionists/svg?seed=Althea-01' },
  { id: 'althea-02', label: 'Preset 02', url: 'https://api.dicebear.com/9.x/notionists/svg?seed=Althea-02' },
  { id: 'althea-03', label: 'Preset 03', url: 'https://api.dicebear.com/9.x/notionists/svg?seed=Althea-03' },
  { id: 'althea-04', label: 'Preset 04', url: 'https://api.dicebear.com/9.x/notionists/svg?seed=Althea-04' },
]

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase()).join('') || 'AP'
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
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [reauthCode, setReauthCode] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [sendingReauth, setSendingReauth] = useState(false)
  const [reauthRequested, setReauthRequested] = useState(false)
  const [telemetry, setTelemetry] = useState<SessionTelemetry>({ ip: null, isp: null, location: null })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true

    async function loadProfile() {
      setIsLoading(true)
      try {
        const { data: userData, error: userError } = await db.auth.getUser()
        if (userError || !userData.user) {
          router.replace('/login')
          return
        }

        const user = userData.user
        const [{ data: dbProfile }, { data: businessProfile }, telemetryResponse] = await Promise.all([
          db.from('profiles').select('id,display_name,full_name,avatar_url,updated_at').eq('id', user.id).maybeSingle(),
          db.from('merchant_business_profiles').select('document_type,document_number,legal_name').eq('user_id', user.id).maybeSingle(),
          fetch('/api/session-telemetry', { cache: 'no-store' }),
        ])

        if (!mounted) return

        const metadata = user.user_metadata ?? {}
        const resolvedName = String(dbProfile?.display_name ?? dbProfile?.full_name ?? metadata.display_name ?? metadata.full_name ?? metadata.name ?? '')
        setProfile(dbProfile as ProfileRecord | null)
        setBusiness(businessProfile as BusinessProfileRecord | null)
        setName(resolvedName)
        setEmail(user.email ?? '')
        setPhone(user.phone ?? '')
        setAvatarUrl(String(dbProfile?.avatar_url ?? metadata.avatar_url ?? metadata.picture ?? ''))

        if (telemetryResponse.ok) {
          const payload = await telemetryResponse.json() as SessionTelemetry
          if (mounted) setTelemetry(payload)
        }
      } catch (loadError) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar o perfil.')
      } finally {
        if (mounted) setIsLoading(false)
      }
    }

    void loadProfile()
    return () => { mounted = false }
  }, [db, router])

  async function requestSecurityCode() {
    if (sendingReauth || !email) return
    setError('')
    setMessage('')
    setSendingReauth(true)

    try {
      const { error: reauthError } = await db.auth.reauthenticate()
      if (reauthError) throw reauthError
      setReauthRequested(true)
      setMessage('Código de segurança enviado para o e-mail cadastrado.')
    } catch (reauthError) {
      setError(reauthError instanceof Error ? reauthError.message : 'Não foi possível enviar o código de segurança.')
    } finally {
      setSendingReauth(false)
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSaving) return
    setError('')
    setMessage('')
    setIsSaving(true)

    try {
      const { data: userData, error: userError } = await db.auth.getUser()
      const user = userData.user
      if (userError || !user) throw new Error(userError?.message || 'Sessão não encontrada.')

      const cleanName = name.trim()
      if (!cleanName) throw new Error('Informe o nome de exibição.')

      const changingPassword = Boolean(newPassword)
      if (changingPassword) {
        if (newPassword.length < 8) throw new Error('A nova senha precisa ter pelo menos 8 caracteres.')
        if (!currentPassword) throw new Error('Informe a senha atual para alterar a senha.')
        if (!reauthRequested || !reauthCode.trim()) throw new Error('Envie e informe o código de segurança antes de alterar a senha.')

        const currentEmail = user.email?.toLowerCase() ?? ''
        const { error: passwordCheckError } = await db.auth.signInWithPassword({ email: currentEmail, password: currentPassword })
        if (passwordCheckError) throw new Error('A senha atual não pôde ser validada.')
      }

      const nextMetadata = {
        ...user.user_metadata,
        display_name: cleanName,
        full_name: cleanName,
        name: cleanName,
        avatar_url: avatarUrl || null,
      }

      const updateAttributes: Parameters<typeof db.auth.updateUser>[0] = {
        data: nextMetadata,
      }

      if (changingPassword) {
        updateAttributes.password = newPassword
        updateAttributes.nonce = reauthCode.trim()
      }

      const { data: updatedUser, error: authUpdateError } = await db.auth.updateUser(updateAttributes)
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
      setName(String(updatedUser.user?.user_metadata?.display_name ?? cleanName))
      setCurrentPassword('')
      setNewPassword('')
      setReauthCode('')
      setReauthRequested(false)
      setMessage(changingPassword ? 'Perfil salvo e senha alterada com verificação de segurança.' : 'Perfil atualizado com sucesso.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar as alterações.')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading && !profile && !email) {
    return (
      <div className="space-y-4 pb-32 font-['Space_Grotesk']">
        <div className="h-20 animate-pulse rounded-2xl bg-[#0B0B0F]" />
        <div className="h-80 animate-pulse rounded-2xl bg-[#0B0B0F]" />
        <div className="h-64 animate-pulse rounded-2xl bg-[#0B0B0F]" />
      </div>
    )
  }

  const displayName = name || 'Meu Perfil'
  const documentLabel = business?.document_type || 'CPF/CNPJ'
  const location = telemetry.location || 'Não disponível'
  const ip = telemetry.ip || 'Não disponível'
  const isp = telemetry.isp || 'Não disponível pelo navegador/edge'
  const browser = typeof window !== 'undefined' ? window.navigator.userAgent : 'Não disponível'
  const timezone = typeof window !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Não disponível'

  return (
    <div className="min-h-full bg-[#060608] pb-32 font-['Space_Grotesk'] text-zinc-100">
      <header className="sticky top-0 z-40 -mx-4 mb-5 border-b border-[#191921] bg-[#060608]/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <button type="button" onClick={() => router.push('/dashboard/settings')} className="inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-zinc-400 transition hover:text-white">
          <ArrowLeft size={15} />
          Voltar
        </button>
      </header>

      <main className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="space-y-5">
          <div className="rounded-2xl border border-[#191921] bg-[#0B0B0F] p-5">
            <div className="flex items-center gap-4">
              <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border border-[#1DB854]/30 bg-[#060608] text-lg font-bold text-[#1DB854]">
                {avatarUrl ? <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" onError={() => setAvatarUrl('')} /> : initials(displayName)}
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold tracking-tight text-white">Meu Perfil</h1>
                <p className="truncate text-xs text-zinc-400">{displayName}</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSave} className="space-y-5">
            <section className="rounded-2xl border border-[#191921] bg-[#0B0B0F] p-5">
              <div className="mb-4 flex items-center gap-2">
                <UserRound size={16} className="text-[#1DB854]" />
                <h2 className="text-sm font-semibold text-white">Identidade</h2>
              </div>

              <div className="space-y-4">
                <label className="block space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Nome de exibição</span>
                  <input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} className="min-h-11 w-full rounded-xl border border-[#191921] bg-[#060608] px-3 text-sm text-white outline-none transition focus:border-[#1DB854]/50" />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">E-mail de login</span>
                  <div className="relative">
                    <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                    <input value={email} readOnly aria-readonly="true" className="min-h-11 w-full cursor-not-allowed rounded-xl border border-[#191921] bg-[#060608] pl-9 pr-3 text-sm text-zinc-500 outline-none" />
                  </div>
                </label>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Telefone</span>
                    <input value={phone || 'Não cadastrado'} readOnly aria-readonly="true" className="min-h-11 w-full cursor-not-allowed rounded-xl border border-[#191921] bg-[#060608] px-3 text-sm text-zinc-500 outline-none" />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{documentLabel}</span>
                    <input value={maskDocument(business?.document_number ?? null)} readOnly aria-readonly="true" className="min-h-11 w-full cursor-not-allowed rounded-xl border border-[#191921] bg-[#060608] px-3 font-mono text-sm text-zinc-500 outline-none" />
                  </label>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-[#191921] bg-[#0B0B0F] p-5">
              <div className="mb-4 flex items-center gap-2">
                <UserRound size={16} className="text-[#1DB854]" />
                <h2 className="text-sm font-semibold text-white">Avatar</h2>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {AVATAR_PRESETS.map((preset) => (
                  <button key={preset.id} type="button" aria-label={preset.label} onClick={() => setAvatarUrl(preset.url)} className={`h-12 w-12 shrink-0 overflow-hidden rounded-full border-2 bg-[#060608] p-0.5 transition ${avatarUrl === preset.url ? 'border-[#1DB854]' : 'border-[#191921] hover:border-zinc-600'}`}>
                    <img src={preset.url} alt="" className="h-full w-full rounded-full object-cover" />
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-[#191921] bg-[#0B0B0F] p-5">
              <div className="mb-4 flex items-center gap-2">
                <KeyRound size={16} className="text-[#1DB854]" />
                <h2 className="text-sm font-semibold text-white">Credenciais</h2>
              </div>
              <div className="space-y-4">
                <label className="block space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Senha atual</span>
                  <div className="relative">
                    <input type={showCurrentPassword ? 'text' : 'password'} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="••••••••" className="min-h-11 w-full rounded-xl border border-[#191921] bg-[#060608] px-3 pr-11 text-sm text-white outline-none focus:border-[#1DB854]/50" />
                    <button type="button" aria-label={showCurrentPassword ? 'Ocultar senha atual' : 'Mostrar senha atual'} onClick={() => setShowCurrentPassword((value) => !value)} className="absolute right-1 top-1 min-h-10 min-w-10 place-items-center text-zinc-500"><span className="grid place-items-center h-10 w-10">{showCurrentPassword ? <EyeOff size={15} /> : <Eye size={15} />}</span></button>
                  </div>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Nova senha</span>
                  <div className="relative">
                    <input type={showNewPassword ? 'text' : 'password'} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Mínimo 8 caracteres" className="min-h-11 w-full rounded-xl border border-[#191921] bg-[#060608] px-3 pr-11 text-sm text-white outline-none focus:border-[#1DB854]/50" />
                    <button type="button" aria-label={showNewPassword ? 'Ocultar nova senha' : 'Mostrar nova senha'} onClick={() => setShowNewPassword((value) => !value)} className="absolute right-1 top-1 min-h-10 min-w-10 place-items-center text-zinc-500"><span className="grid place-items-center h-10 w-10">{showNewPassword ? <EyeOff size={15} /> : <Eye size={15} />}</span></button>
                  </div>
                </label>
                <div className="rounded-xl border border-[#191921] bg-[#060608] p-3">
                  <div className="flex items-start gap-3">
                    <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#1DB854]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-white">Verificação por e-mail</p>
                      <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">Para trocar a senha, solicite um código de reautenticação e informe o código recebido neste formulário.</p>
                      {reauthRequested && <input inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={reauthCode} onChange={(event) => setReauthCode(event.target.value.replace(/\D/g, ''))} placeholder="Código de segurança" className="mt-3 min-h-11 w-full rounded-xl border border-[#191921] bg-[#0B0B0F] px-3 font-mono text-sm tracking-[0.25em] text-white outline-none focus:border-[#1DB854]/50" />}
                    </div>
                  </div>
                  <button type="button" onClick={() => void requestSecurityCode()} disabled={sendingReauth || !email} className="mt-3 min-h-11 w-full rounded-xl border border-[#191921] bg-[#0B0B0F] text-xs font-semibold text-white transition hover:border-zinc-700 disabled:cursor-wait disabled:opacity-50">{sendingReauth ? 'Enviando…' : reauthRequested ? 'Reenviar código' : 'Enviar código de segurança'}</button>
                </div>
              </div>
            </section>

            {error && <div className="rounded-xl border border-rose-900/40 bg-rose-950/20 p-3 text-xs text-rose-300" role="alert">{error}</div>}
            {message && <div className="flex items-center gap-2 rounded-xl border border-[#1DB854]/20 bg-[#1DB854]/5 p-3 text-xs text-[#1DB854]" role="status"><Check size={15} />{message}</div>}

            <button type="submit" disabled={isSaving} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#1DB854] px-4 text-sm font-bold text-[#060608] transition active:scale-[0.99] disabled:cursor-wait disabled:opacity-60">
              <Save size={15} />
              {isSaving ? 'Salvando…' : 'Salvar alterações'}
            </button>
          </form>
        </section>

        <section className="space-y-5">
          <div className="rounded-2xl border border-[#191921] bg-[#0B0B0F] p-5">
            <div className="mb-4 flex items-center gap-2">
              <LockKeyhole size={16} className="text-[#1DB854]" />
              <h2 className="text-sm font-semibold text-white">Sessão atual</h2>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div className="rounded-xl border border-[#191921] bg-[#060608] p-3"><span className="text-[10px] text-zinc-600">IP de conexão</span><strong className="mt-1 block break-all font-mono text-xs text-zinc-300">{ip}</strong></div>
              <div className="rounded-xl border border-[#191921] bg-[#060608] p-3"><span className="text-[10px] text-zinc-600">ISP</span><strong className="mt-1 block text-xs text-zinc-300">{isp}</strong></div>
              <div className="rounded-xl border border-[#191921] bg-[#060608] p-3"><span className="text-[10px] text-zinc-600">Localização</span><strong className="mt-1 block text-xs text-zinc-300">{location}</strong></div>
              <div className="rounded-xl border border-[#191921] bg-[#060608] p-3"><span className="text-[10px] text-zinc-600">Fuso horário</span><strong className="mt-1 block text-xs text-zinc-300">{timezone}</strong></div>
            </div>
            <div className="mt-3 flex items-start gap-3 rounded-xl border border-[#191921] bg-[#060608] p-3">
              <Monitor size={15} className="mt-0.5 shrink-0 text-zinc-500" />
              <div className="min-w-0"><span className="text-[10px] text-zinc-600">Navegador</span><p className="mt-1 break-words text-[10px] leading-relaxed text-zinc-500">{browser}</p></div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#191921] bg-[#0B0B0F] p-5">
            <div className="mb-3 flex items-center gap-2"><ShieldCheck size={16} className="text-[#1DB854]" /><h2 className="text-sm font-semibold text-white">Integridade da identidade</h2></div>
            <div className="space-y-3 text-xs text-zinc-500">
              <p>O e-mail de login é mantido somente para leitura nesta interface.</p>
              <p>CPF/CNPJ e razão social permanecem vinculados ao cadastro empresarial e não podem ser alterados pelo perfil.</p>
              <p>O IP e a localização são obtidos no contexto da requisição quando o ambiente fornece esses cabeçalhos. O navegador não expõe ISP de forma confiável; por isso o sistema não inventa esse dado.</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
