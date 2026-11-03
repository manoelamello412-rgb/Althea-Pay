'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import BrandLogo from '@/components/brand-logo'
import { nextFromSearch } from '@/lib/auth/navigation'
import { authErrorPt } from '@/lib/auth/errors'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

// Second step of the login for accounts with 2FA (proxy.ts sends aal1 sessions here).
export default function MfaPage() {
  const router = useRouter()
  const [factorId, setFactorId] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void createSupabaseBrowserClient().auth.mfa.listFactors().then(({ data, error: listError }) => {
      if (listError) { setError(authErrorPt(listError.message)); return }
      const factor = data?.totp[0]
      if (factor) setFactorId(factor.id)
      else setError('Nenhum autenticador encontrado nesta conta.')
    })
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true); setError('')
    const { error: verifyError } = await createSupabaseBrowserClient().auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
    setLoading(false)
    if (verifyError) { setError(authErrorPt(verifyError.message)); setCode(''); return }
    router.replace(nextFromSearch(window.location.search))
    router.refresh()
  }

  async function signOut() {
    await createSupabaseBrowserClient().auth.signOut()
    router.replace('/login')
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-lockup">
          <BrandLogo variant="main" alt="Althea Pay" priority style={{ height: '120px', width: 'auto', display: 'block', margin: '0 auto', objectFit: 'contain' }} />
        </div>
        <div className="auth-heading">
          <span>VERIFICAÇÃO EM 2 ETAPAS</span>
          <h1>Digite o código</h1>
          <p>Abra o app autenticador e digite o código de 6 dígitos da Althea Pay.</p>
        </div>
        <form onSubmit={submit} className="auth-form">
          <label>Código<input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" autoFocus required /></label>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="primary auth-submit" type="submit" disabled={loading || !factorId || code.length !== 6}>{loading ? 'Verificando...' : 'Confirmar'}</button>
          <button type="button" className="auth-switch" onClick={() => void signOut()}>Entrar com outra conta</button>
        </form>
      </section>
    </main>
  )
}
