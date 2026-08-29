'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '../../lib/supabase/client'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    const supabase = createSupabaseBrowserClient()
    if (!supabase) {
      setError('O ALTHEA PAY ainda não está conectado ao Supabase neste ambiente.')
      return
    }
    setLoading(true)
    const redirectTo = `${window.location.origin}/reset-password`
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    if (error) setError(error.message)
    else setMessage('Se existir uma conta com este e-mail, enviaremos um link para redefinir sua senha.')
    setLoading(false)
  }

  return <main className="auth-shell"><section className="auth-card">
    <div className="althea-brand auth-brand">ALTHEA PAY<span>Control Center</span></div>
    <div className="auth-heading"><span>RECUPERAÇÃO SEGURA</span><h1>Esqueci minha senha</h1><p>Informe seu e-mail para receber o link de redefinição.</p></div>
    <form onSubmit={handleSubmit} className="auth-form">
      <label>E-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required /></label>
      {error&&<div className="auth-error" role="alert">{error}</div>}
      {message&&<div className="auth-message" role="status">{message}</div>}
      <button className="primary auth-submit" disabled={loading}>{loading?'Enviando...':'Enviar link de recuperação'}</button>
    </form>
    <button className="auth-switch" onClick={()=>router.push('/login')}>← Voltar para o login</button>
  </section></main>
}
