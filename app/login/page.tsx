'use client'

import { FormEvent, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '../../lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') || '/'
  const supabase = createSupabaseBrowserClient()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')

    if (!supabase) {
      setError('O ALTHEA PAY ainda não está conectado ao Supabase neste ambiente. Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.')
      return
    }

    setLoading(true)
    const result = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } })

    if (result.error) {
      setError(result.error.message)
    } else if (mode === 'signup' && !result.data.session) {
      setMessage('Cadastro criado. Confirme seu e-mail para entrar no ALTHEA PAY.')
    } else {
      router.replace(next)
      router.refresh()
    }

    setLoading(false)
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="althea-brand auth-brand">ALTHEA PAY<span>Control Center</span></div>
        <div className="auth-heading">
          <span>ACESSO SEGURO</span>
          <h1>{mode === 'login' ? 'Entrar no painel' : 'Criar sua conta'}</h1>
          <p>{mode === 'login' ? 'Acesse seu centro de controle operacional.' : 'Crie seu acesso para começar a operar.'}</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {mode === 'signup' && (
            <label>Nome<input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required /></label>
          )}
          <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
          <label>Senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={6} required /></label>
          {error && <div className="auth-error" role="alert">{error}</div>}
          {message && <div className="auth-message" role="status">{message}</div>}
          <button className="primary auth-submit" type="submit" disabled={loading}>{loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
        </form>

        <button className="auth-switch" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage('') }}>
          {mode === 'login' ? 'Ainda não tenho conta → Criar acesso' : 'Já tenho uma conta → Entrar'}
        </button>
      </section>
    </main>
  )
}
