'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, Eye, EyeOff, KeyRound, Mail, UserRound } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase()).join('') || 'U'
}

export default function PerfilSettingsPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    void db.auth.getUser().then(({ data, error: userError }) => {
      if (!mounted) return
      if (userError || !data.user) {
        setError(userError?.message || 'Não foi possível carregar o perfil.')
        setIsLoading(false)
        return
      }
      const metadata = data.user.user_metadata ?? {}
      setName(String(metadata.full_name ?? metadata.name ?? ''))
      setEmail(data.user.email ?? '')
      setIsLoading(false)
    })
    return () => { mounted = false }
  }, [db])

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setIsLoading(true)

    try {
      const { data: userData, error: userError } = await db.auth.getUser()
      const user = userData.user
      if (userError || !user) throw new Error(userError?.message || 'Sessão não encontrada.')

      const cleanName = name.trim()
      const cleanEmail = email.trim().toLowerCase()

      if (!cleanName) throw new Error('Informe um nome de exibição.')
      if (!cleanEmail) throw new Error('Informe um e-mail de acesso válido.')
      if (newPassword && newPassword.length < 6) throw new Error('A nova senha precisa ter pelo menos 6 caracteres.')
      if (newPassword && !currentPassword) throw new Error('Informe a senha atual para alterar a senha.')

      const currentEmail = user.email?.toLowerCase() ?? ''

      if (newPassword) {
        const { error: reauthError } = await db.auth.signInWithPassword({
          email: currentEmail,
          password: currentPassword,
        })
        if (reauthError) throw new Error('A senha atual não pôde ser validada.')
      }

      const profilePayload: { data: { full_name: string; name: string }; email?: string } = {
        data: { full_name: cleanName, name: cleanName },
      }
      if (cleanEmail !== currentEmail) profilePayload.email = cleanEmail
      if (newPassword) profilePayload.data = { ...profilePayload.data }

      const { error: updateError } = await db.auth.updateUser({
        ...(profilePayload.email ? { email: profilePayload.email } : {}),
        data: profilePayload.data,
        ...(newPassword ? { password: newPassword } : {}),
      })
      if (updateError) throw new Error(updateError.message)

      setName(cleanName)
      setEmail(cleanEmail)
      setCurrentPassword('')
      setNewPassword('')
      setMessage(cleanEmail !== currentEmail ? 'Perfil salvo. Confirme o novo e-mail se a autenticação solicitar.' : 'Dados do perfil atualizados com sucesso.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar as alterações.')
    } finally {
      setIsLoading(false)
    }
  }

  const displayName = name || 'Meu Perfil'

  if (isLoading && !email) {
    return <div className="space-y-4 pb-32 font-['Space_Grotesk']"><div className="h-24 animate-pulse rounded-2xl bg-[#0F1A16]/60" /><div className="h-72 animate-pulse rounded-2xl bg-[#0F1A16]/40" /></div>
  }

  return (
    <div className="space-y-5 pb-32 text-left font-['Space_Grotesk'] text-white">
      <header className="flex items-center gap-3 rounded-2xl border border-zinc-900 bg-[#0F1A16]/40 p-4">
        <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full border border-[#1DB854]/30 bg-[#060608] text-lg font-bold text-[#1DB854]">
          {userAvatar(db, displayName, initials(displayName))}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight">Meu Perfil</h1>
          <p className="truncate text-xs text-zinc-400">{displayName}</p>
          <p className="truncate text-[11px] text-zinc-600">{email}</p>
        </div>
      </header>

      <form onSubmit={handleSave} className="space-y-4">
        <section className="space-y-4 rounded-2xl border border-zinc-900 bg-[#0F1A16]/40 p-4">
          <div className="flex items-center gap-2"><UserRound size={15} className="text-[#1DB854]" /><span className="text-[10px] font-bold uppercase tracking-wider text-[#1DB854]">Informações Pessoais</span></div>
          <label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Nome de Exibição</span><input required type="text" maxLength={100} placeholder="Seu nome completo" className="w-full rounded-xl border border-zinc-900 bg-[#060608] p-3 text-xs text-white outline-none transition focus:border-[#1DB854]/40" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">E-mail de Acesso</span><div className="relative"><Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" /><input required type="email" maxLength={254} className="w-full rounded-xl border border-zinc-900 bg-[#060608] py-3 pl-9 pr-3 text-xs text-white outline-none transition focus:border-[#1DB854]/40" value={email} onChange={(e) => setEmail(e.target.value)} /></div></label>
        </section>

        <section className="space-y-4 rounded-2xl border border-zinc-900 bg-[#0F1A16]/40 p-4">
          <div className="flex items-center gap-2"><KeyRound size={15} className="text-[#1DB854]" /><span className="text-[10px] font-bold uppercase tracking-wider text-[#1DB854]">Alterar Senha</span></div>
          <label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Senha Atual</span><div className="relative"><input type={showCurrentPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••" className="w-full rounded-xl border border-zinc-900 bg-[#060608] p-3 pr-10 text-xs text-white outline-none transition focus:border-[#1DB854]/40" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /> <button type="button" aria-label="Mostrar senha atual" className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-zinc-500" onClick={() => setShowCurrentPassword((v) => !v)}>{showCurrentPassword ? <EyeOff size={14} /> : <Eye size={14} />}</button></div></label>
          <label className="block space-y-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Nova Senha</span><div className="relative"><input type={showNewPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="Mínimo 6 caracteres" className="w-full rounded-xl border border-zinc-900 bg-[#060608] p-3 pr-10 text-xs text-white outline-none transition focus:border-[#1DB854]/40" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /> <button type="button" aria-label="Mostrar nova senha" className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-zinc-500" onClick={() => setShowNewPassword((v) => !v)}>{showNewPassword ? <EyeOff size={14} /> : <Eye size={14} />}</button></div></label>
          <p className="text-[10px] leading-relaxed text-zinc-600">A senha atual é usada somente para validar a troca de senha. Ela não é armazenada pela aplicação.</p>
        </section>

        {error && <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-3 text-[10px] leading-relaxed text-red-300" role="alert">{error}</div>}
        {message && <div className="flex items-center gap-2 rounded-xl border border-[#1DB854]/20 bg-[#1DB854]/5 p-3 text-[10px] leading-relaxed text-[#1DB854]" role="status"><Check size={14} />{message}</div>}

        <button type="submit" disabled={isLoading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1DB854] py-3 text-xs font-bold text-black transition-all duration-200 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60">{isLoading ? 'Salvando Alterações...' : 'Salvar Alterações no Perfil 💾'}</button>
      </form>
    </div>
  )
}

function userAvatar(_db: ReturnType<typeof createSupabaseBrowserClient>, _name: string, fallback: string) {
  return <span aria-label="Avatar do usuário">{fallback}</span>
}
