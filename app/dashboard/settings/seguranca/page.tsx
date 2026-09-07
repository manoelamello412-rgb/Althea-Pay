'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, ChevronLeft, KeyRound, Shield, ShieldCheck, Smartphone, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type SessionRow = { id: string; ip: string | null; device: string; location: string | null; active: boolean; last_seen_at: string; created_at: string }
type Factor = { id: string; friendly_name: string | null; status: string }

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export default function SegurancaSettingsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [factors, setFactors] = useState<Factor[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string; challengeId: string } | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingPassword, setSavingPassword] = useState(false)
  const [savingMfa, setSavingMfa] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const mfaActive = factors.some((factor) => factor.status === 'verified')

  async function load() {
    setLoading(true); setError('')
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) { setError('Sessão expirada.'); setLoading(false); return }
    const [factorResult, sessionResult] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.from('frontend_device_sessions').select('id,ip,device,location,active,last_seen_at,created_at').eq('user_id', auth.user.id).order('last_seen_at', { ascending: false }).limit(20),
    ])
    if (factorResult.error) setError(factorResult.error.message)
    else setFactors((factorResult.data.totp ?? []).map((factor) => ({ id: factor.id, friendly_name: factor.friendly_name ?? null, status: factor.status })))
    if (sessionResult.error) setError((current) => current || sessionResult.error.message)
    else setSessions((sessionResult.data ?? []) as SessionRow[])
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSavingPassword(true); setMessage(''); setError('')
    try {
      if (!currentPassword || !newPassword) throw new Error('Informe a senha atual e a nova senha.')
      if (newPassword.length < 6) throw new Error('A nova senha precisa ter pelo menos 6 caracteres.')
      if (newPassword !== confirmPassword) throw new Error('A confirmação da nova senha não coincide.')
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || !auth.user?.email) throw authError ?? new Error('Sessão expirada.')
      const reauth = await supabase.auth.signInWithPassword({ email: auth.user.email, password: currentPassword })
      if (reauth.error) throw new Error('A senha atual não pôde ser validada.')
      const update = await supabase.auth.updateUser({ password: newPassword })
      if (update.error) throw update.error
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setMessage('Senha principal atualizada com sucesso.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível alterar a senha.') }
    finally { setSavingPassword(false) }
  }

  async function enableMfa() {
    setSavingMfa(true); setMessage(''); setError('')
    try {
      const result = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Althea Pay Authenticator' })
      if (result.error || !result.data) throw result.error ?? new Error('Não foi possível iniciar o MFA.')
      const challenge = await supabase.auth.mfa.challenge({ factorId: result.data.id })
      if (challenge.error) throw challenge.error
      setEnrolling({ id: result.data.id, qr: result.data.totp.qr_code, secret: result.data.totp.secret, challengeId: challenge.data.id })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível iniciar o MFA.') }
    finally { setSavingMfa(false) }
  }

  async function verifyMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!enrolling) return
    setSavingMfa(true); setMessage(''); setError('')
    try {
      const result = await supabase.auth.mfa.verify({ factorId: enrolling.id, challengeId: enrolling.challengeId, code: mfaCode.trim() })
      if (result.error) throw result.error
      setEnrolling(null); setMfaCode(''); setMessage('Autenticação em 2 etapas ativada.')
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Código MFA inválido.') }
    finally { setSavingMfa(false) }
  }

  async function disableMfa(factorId: string) {
    setSavingMfa(true); setMessage(''); setError('')
    try {
      const result = await supabase.auth.mfa.unenroll({ factorId })
      if (result.error) throw result.error
      setFactors((current) => current.filter((factor) => factor.id !== factorId)); setMessage('Autenticação em 2 etapas desativada.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível desativar o MFA.') }
    finally { setSavingMfa(false) }
  }

  return (
    <main className="w-full space-y-4 pb-32 font-['Space_Grotesk'] text-left text-white">
      <div className="flex items-center justify-between border-b border-[#0D362D]/30 pb-2">
        <button type="button" onClick={() => router.push('/dashboard/settings')} className="flex items-center gap-1.5 text-xs font-bold text-[#A6A6A6] transition-colors hover:text-white"><ChevronLeft className="h-4 w-4 text-[#1DB854]" />Voltar</button>
        <div className="flex items-center gap-1.5"><Shield className="h-3.5 w-3.5 text-[#1DB854]" /><span className="text-[10px] font-bold uppercase tracking-wider text-slate-200">Segurança</span></div>
      </div>

      <section className="rounded-2xl border border-[#0D362D] bg-[#0F1A16] p-4">
        <div className="mb-4 flex items-center gap-2"><KeyRound className="h-4 w-4 text-[#1DB854]" /><div><h1 className="text-sm font-bold">Alterar Senha Mestre</h1><p className="text-[10px] text-[#A6A6A6]">Validação da credencial atual antes da substituição.</p></div></div>
        <form onSubmit={updatePassword} className="space-y-2.5">
          <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Senha atual" className="w-full rounded-xl border border-[#0D362D] bg-[#0B0B0D] px-3 py-2.5 text-xs outline-none focus:border-[#1DB854]/60" />
          <input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Nova senha de acesso" className="w-full rounded-xl border border-[#0D362D] bg-[#0B0B0D] px-3 py-2.5 text-xs outline-none focus:border-[#1DB854]/60" />
          <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirmar nova senha" className="w-full rounded-xl border border-[#0D362D] bg-[#0B0B0D] px-3 py-2.5 text-xs outline-none focus:border-[#1DB854]/60" />
          <button disabled={savingPassword} type="submit" className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#1DB854] text-xs font-bold text-black disabled:opacity-50">{savingPassword ? <Loader2 className="animate-spin" size={14}/> : <KeyRound size={14}/>}Atualizar Credenciais</button>
        </form>
      </section>

      <section className="rounded-2xl border border-[#0D362D] bg-[#0F1A16] p-4">
        <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#0B0B0D] text-[#1DB854]"><Smartphone size={17}/></span><div><h2 className="text-sm font-bold">Autenticação em 2 Etapas (MFA)</h2><p className="text-[10px] text-[#A6A6A6]">Proteção adicional com aplicativo autenticador.</p></div></div><span className={`rounded-full px-2 py-1 text-[9px] font-bold ${mfaActive ? 'bg-[#1DB854]/10 text-[#1DB854]' : 'bg-zinc-900 text-zinc-500'}`}>{mfaActive ? 'ATIVO' : 'INATIVO'}</span></div>
        {!mfaActive && !enrolling && <button type="button" onClick={() => void enableMfa()} disabled={savingMfa} className="mt-4 w-full rounded-xl border border-[#1DB854]/40 bg-[#1DB854]/10 py-2.5 text-xs font-bold text-[#1DB854] disabled:opacity-50">Ativar MFA</button>}
        {mfaActive && factors.filter((factor) => factor.status === 'verified').map((factor) => <div key={factor.id} className="mt-4 flex items-center justify-between rounded-xl border border-[#0D362D] bg-[#0B0B0D] p-3"><div><p className="text-xs font-bold">{factor.friendly_name || 'Aplicativo autenticador'}</p><p className="text-[10px] text-[#A6A6A6]">Fator TOTP verificado.</p></div><button type="button" onClick={() => void disableMfa(factor.id)} disabled={savingMfa} className="text-[10px] font-bold text-red-400 disabled:opacity-50">Desativar</button></div>)}
        {enrolling && <form onSubmit={verifyMfa} className="mt-4 space-y-3 rounded-xl border border-[#0D362D] bg-[#0B0B0D] p-3"><p className="text-xs font-bold">Conecte seu autenticador</p><img src={enrolling.qr} alt="QR Code para configurar o autenticador" className="mx-auto h-40 w-40 rounded-lg bg-white p-2" /><p className="break-all text-center font-mono text-[9px] text-zinc-500">Chave manual: {enrolling.secret}</p><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))} placeholder="Código de 6 dígitos" className="w-full rounded-xl border border-[#0D362D] bg-[#060608] px-3 py-2.5 text-center font-mono text-sm tracking-[0.3em] outline-none focus:border-[#1DB854]/60" /><button disabled={savingMfa || mfaCode.length !== 6} type="submit" className="w-full rounded-xl bg-[#1DB854] py-2.5 text-xs font-bold text-black disabled:opacity-40">Verificar e ativar</button></form>}
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-1.5 px-1"><ShieldCheck size={14} className="text-zinc-500"/><span className="text-[10px] font-bold uppercase tracking-wider text-[#A6A6A6]">Acessos e Sessões Registrados</span></div>
        <div className="space-y-2">
          {loading ? <div className="animate-pulse space-y-2"><div className="h-16 rounded-xl bg-[#0F1A16]"/><div className="h-16 rounded-xl bg-[#0F1A16]"/></div> : sessions.length === 0 ? <div className="rounded-xl border border-zinc-900 bg-[#0F1A16]/50 p-4 text-[10px] text-zinc-500">Nenhum acesso registrado nesta conta ainda.</div> : sessions.map((session) => <article key={session.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#0D362D] bg-[#0F1A16] p-3"><div className="min-w-0"><p className="truncate font-mono text-xs font-bold text-slate-200">{session.ip || 'IP não registrado'}</p><p className="truncate text-[10px] text-[#A6A6A6]">{session.device}{session.location ? ` • ${session.location}` : ''}</p></div><div className="shrink-0 text-right"><span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${session.active ? 'bg-[#1DB854]/10 text-[#1DB854]' : 'bg-zinc-900 text-zinc-500'}`}>{session.active ? 'ATIVO' : 'ENCERRADO'}</span><p className="mt-1 text-[9px] text-zinc-600">{formatDate(session.last_seen_at)}</p></div></article>)}
        </div>
      </section>

      {message && <div className="flex items-center gap-2 rounded-xl border border-[#1DB854]/20 bg-[#1DB854]/5 p-3 text-[10px] text-[#1DB854]" role="status"><CheckCircle2 size={14}/>{message}</div>}
      {error && <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-3 text-[10px] leading-relaxed text-red-300" role="alert">{error}</div>}
    </main>
  )
}
