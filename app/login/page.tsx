'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
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
      setError('O ALTHEA PAY ainda não está conectado ao Supabase neste ambiente.')
      return
    }
    setLoading(true)
    try {
      if (mode === 'login') {
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
        if (!data.session) {
          setError('Não foi possível criar sua sessão. Tente novamente.')
          return
        }
        setMessage('Login realizado. Abrindo seu painel...')
        router.replace('/')
        router.refresh()
      } else {
        if (password.length < 6) {
          setError('A senha precisa ter pelo menos 6 caracteres.')
          return
        }
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: fullName.trim() } } })
        if (error) throw error
        if (data.session) {
          setMessage('Conta criada e acesso liberado. Abrindo seu painel...')
          router.replace('/')
          router.refresh()
        } else {
          setMessage('Conta criada. Se a confirmação por e-mail estiver ativada, será necessário confirmar o endereço antes de entrar.')
        }
      }
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
          <h1>{mode === 'login' ? 'Entrar no painel' : 'Criar sua conta'}</h1>
          <p>{mode === 'login' ? 'Acesse seu centro de controle operacional.' : 'Crie seu acesso para começar a operar.'}</p>
        </div>
        <form onSubmit={handleSubmit} className="auth-form">
          {mode === 'signup' && <label>Nome<input value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" required /></label>}
          <label>E-mail<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required /></label>
          <label>Senha<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={6} required /></label>
          {mode === 'login' && <button type="button" className="auth-switch auth-forgot" onClick={() => router.push('/forgot-password')}>Esqueci minha senha</button>}
          {error && <div className="auth-error" role="alert">{error}</div>}
          {message && <div className="auth-message" role="status">{message}</div>}
          <button className="primary auth-submit" type="submit" disabled={loading}>{loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
        </form>
        <button type="button" className="auth-switch" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage('') }}>
          {mode === 'login' ? 'Ainda não tenho conta → Criar acesso' : 'Já tenho uma conta → Entrar'}
        </button>
      </section>
    </main>
  )
}
