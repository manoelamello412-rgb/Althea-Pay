import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './althea-styles.css'

export const metadata: Metadata = {
  title: 'ALTHEA PAY — Control Center',
  description: 'Central de controle, inteligência e operações dos seus funis.',
  icons: {
    icon: '/althea-mark.png',
    shortcut: '/althea-mark.png',
    apple: '/althea-mark.png',
  },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
