'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error('ALTHEA PAY route error', error)
  }, [error])

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: '#0B0B0D',
        color: '#F5F5F5',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <section style={{ maxWidth: 520, textAlign: 'center' }}>
        <p style={{ color: '#1DB854', fontWeight: 700, letterSpacing: '.08em' }}>ALTHEA PAY</p>
        <h1 style={{ fontSize: 28, margin: '8px 0 12px' }}>Algo não saiu como esperado.</h1>
        <p style={{ color: '#A6A6A6', lineHeight: 1.6 }}>
          O painel encontrou um erro inesperado. Seus dados não são exibidos nesta tela de erro.
        </p>
        <button
          type="button"
          onClick={() => unstable_retry()}
          style={{
            marginTop: 20,
            border: 0,
            borderRadius: 10,
            padding: '12px 18px',
            background: '#1DB854',
            color: '#071009',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Tentar novamente
        </button>
      </section>
    </main>
  )
}
