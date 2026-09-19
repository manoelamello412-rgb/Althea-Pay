'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authLink, nextFromSearch } from '@/lib/auth/navigation'
import BrandLogo from '@/components/brand-logo'
import { createSupabaseBrowserClient } from '../../lib/supabase/client'

function friendlyAuthError(message: string) {
  const text = message.toLowerCase()
  if (text.includes('invalid login credentials')) return 'E-mail ou senha incorretos. Confira os dados e tente novamente.'
  if (text.includes('email not confirmed')) return 'Seu e-mail ainda não foi confirmado. Confira sua caixa de entrada ou solicite um novo e-mail de confirmação.'
  if (text.includes('rate limit') || text.includes('too many requests')) return 'Muitas tentativas foram feitas. Aguarde alguns minutos antes de tentar novamente.'
  if (text.includes('password')) return 'A senha informada não é válida.'
  return message
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    try {
      const supabase = createSupabaseBrowserClient()
      if (!supabase) {
        setError('O ALTHEA PAY ainda não está conectado ao Supabase neste ambiente.')
        return
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw error
      if (!data.session) {
        setError('Não foi possível criar sua sessão. Tente novamente.')
        return
      }

      setMessage('Login realizado. Abrindo seu painel...')
      router.replace(nextFromSearch(window.location.search))
      router.refresh()
    } catch (err) {
      setError(friendlyAuthError(err instanceof Error ? err.message : 'Não foi possível concluir a operação.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-lockup">
          <BrandLogo variant="main" alt="Althea Pay" priority style={{ height: '120px', width: 'auto', display: 'block', margin: '0 auto', objectFit: 'contain' }} />
        </div>
        <div className="auth-heading">
          <span>ACESSO SEGURO</span>
          <h1>Entrar no painel</h1>
          <p>Acesso restrito a contas autorizadas pela administração.</p>
        </div>
        <form onSubmit={handleSubmit} className="auth-form">
          <label>E-mail<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required /></label>
          <label>Senha<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /></label>
          <button type="button" className="auth-switch auth-forgot" onClick={() => router.push(authLink('/forgot-password', window.location.search))}>Esqueci minha senha</button>
          {error && <div className="auth-error" role="alert">{error}</div>}
          {message && <div className="auth-message" role="status">{message}</div>}
          <button className="primary auth-submit" type="submit" disabled={loading}>{loading ? 'Aguarde...' : 'Entrar'}</button>
        </form>
      </section>
    </main>
  )
}
