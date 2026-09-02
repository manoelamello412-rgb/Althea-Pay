import type { Metadata } from 'next'
import './globals.css'
import './brand-kit.css'
import './althea-visual.css'
import './dashboard.css'
import './dashboard-responsive.css'
import './official-brand.css'
import './dashboard-polish.css'

export const metadata: Metadata = {
  title: 'ALTHEA PAY — Control Center',
  description: 'Central de controle, inteligência e operações dos seus funis.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
