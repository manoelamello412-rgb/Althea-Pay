'use client'

export default function GlobalError({
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#0B0B0D',
          color: '#F5F5F5',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <main style={{ maxWidth: 520, padding: 24, textAlign: 'center' }}>
          <p style={{ color: '#1DB854', fontWeight: 700, letterSpacing: '.08em' }}>ALTHEA PAY</p>
          <h1>O sistema encontrou um erro.</h1>
          <p style={{ color: '#A6A6A6', lineHeight: 1.6 }}>
            Tente recarregar o painel. Nenhum detalhe técnico sensível é exibido aqui.
          </p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              marginTop: 16,
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
        </main>
      </body>
    </html>
  )
}
