'use client'

import Image from 'next/image'
import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '../../lib/supabase/client'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    if (!supabase) { setError('O ALTHEA PAY ainda não está conectado ao Supabase neste ambiente.'); return }
    let active = true
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) setReady(true)
    })

    async function hydrateRecoverySession() {
      try {
        const url = new URL(window.location.href)
        const code = url.searchParams.get('code')
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) throw error
        }
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error
        if (data.session) setReady(true)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Não foi possível validar o link de recuperação.')
      }
    }

    hydrateRecoverySession()
    const timer = window.setTimeout(() => {
      if (active && !ready) setError(current => current || 'Este link de recuperação é inválido, expirou ou já foi usado. Solicite um novo link.')
    }, 5000)
    return () => { active = false; window.clearTimeout(timer); listener.subscription.unsubscribe() }
  }, [ready])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setMessage('')
    if (password.length < 6) { setError('A senha precisa ter pelo menos 6 caracteres.'); return }
    if (password !== confirm) { setError('As senhas não coincidem.'); return }
    const supabase = createSupabaseBrowserClient()
    if (!supabase) { setError('O ALTHEA PAY ainda não está conectado ao Supabase neste ambiente.'); return }
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setMessage('Senha atualizada com sucesso. Redirecionando para o login...')
      await supabase.auth.signOut()
      window.setTimeout(() => router.replace('/login'), 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível atualizar a senha.')
    } finally { setLoading(false) }
  }

  return <main className="auth-shell"><section className="auth-card">
    <div className="brand-lockup"><Image src="/althea-logo.png.PNG" alt="Althea Pay" width={294} height={230} priority style={{ width: 'min(100%, 294px)', height: 'auto', objectFit: 'contain', filter: 'none' }} /></div>
    <div className="auth-heading"><span>RECUPERAÇÃO SEGURA</span><h1>Nova senha</h1><p>Crie uma nova senha para voltar ao seu painel.</p></div>
    {ready ? <form onSubmit={handleSubmit} className="auth-form"><label>Nova senha<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="new-password" minLength={6} required /></label><label>Confirmar senha<input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} autoComplete="new-password" minLength={6} required /></label>{error&&<div className="auth-error" role="alert">{error}</div>}{message&&<div className="auth-message" role="status">{message}</div>}<button className="primary auth-submit" disabled={loading}>{loading?'Atualizando...':'Atualizar senha'}</button></form> : <div>{error&&<div className="auth-error" role="alert">{error}</div>}<button type="button" className="auth-switch" onClick={()=>router.push('/forgot-password')}>Solicitar novo link</button></div>}
    <button type="button" className="auth-switch" onClick={()=>router.push('/login')}>← Voltar para o login</button>
  </section></main>
}