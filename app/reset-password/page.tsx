'use client'

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
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true)
      else setError('Este link de recuperação é inválido ou expirou. Solicite um novo link.')
    })
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setMessage('')
    if (password.length < 6) { setError('A senha precisa ter pelo menos 6 caracteres.'); return }
    if (password !== confirm) { setError('As senhas não coincidem.'); return }
    const supabase = createSupabaseBrowserClient()
    if (!supabase) return
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) setError(error.message)
    else { setMessage('Senha atualizada com sucesso. Redirecionando para o login...'); await supabase.auth.signOut(); setTimeout(() => router.replace('/login'), 1200) }
    setLoading(false)
  }

  return <main className="auth-shell"><section className="auth-card">
    <div className="althea-brand auth-brand">ALTHEA PAY<span>Control Center</span></div>
    <div className="auth-heading"><span>RECUPERAÇÃO SEGURA</span><h1>Nova senha</h1><p>Crie uma nova senha para voltar ao seu painel.</p></div>
    {ready ? <form onSubmit={handleSubmit} className="auth-form"><label>Nova senha<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="new-password" minLength={6} required /></label><label>Confirmar senha<input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} autoComplete="new-password" minLength={6} required /></label>{error&&<div className="auth-error" role="alert">{error}</div>}{message&&<div className="auth-message" role="status">{message}</div>}<button className="primary auth-submit" disabled={loading}>{loading?'Atualizando...':'Atualizar senha'}</button></form> : <div>{error&&<div className="auth-error" role="alert">{error}</div>}<button className="auth-switch" onClick={()=>router.push('/forgot-password')}>Solicitar novo link</button></div>}
    <button className="auth-switch" onClick={()=>router.push('/login')}>← Voltar para o login</button>
  </section></main>
}
