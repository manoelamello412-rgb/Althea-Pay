'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '../../lib/supabase/client'

const getSiteUrl = () => {
  const configured = process.env.NEXT_PUBLIC_ALTHEA_PAY_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (configured) return configured.replace(/\/$/, '')
  return window.location.origin
}

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [lastSentAt, setLastSentAt] = useState(0)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setMessage('')
    const now = Date.now()
    if (now - lastSentAt < 60000) { setError('Aguarde 60 segundos antes de solicitar outro link.'); return }
    const supabase = createSupabaseBrowserClient()
    if (!supabase) { setError('O ALTHEA PAY ainda não está conectado ao Supabase neste ambiente.'); return }
    setLoading(true)
    try {
      const redirectTo = `${getSiteUrl()}/reset-password`
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
      if (error) throw error
      setLastSentAt(now)
      setMessage('Solicitação registrada. Se este e-mail tiver uma conta, o Supabase enviará o link quando o serviço de e-mail estiver disponível. Verifique também o spam.')
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Não foi possível solicitar a recuperação.'
      const lower = text.toLowerCase()
      if (lower.includes('rate limit') || lower.includes('too many requests')) setError('O envio de e-mails do Supabase atingiu o limite temporário. Aguarde e tente novamente mais tarde.')
      else setError(text)
    } finally { setLoading(false) }
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
    <button type="button" className="auth-switch" onClick={()=>router.push('/login')}>← Voltar para o login</button>
  </section></main>
}
