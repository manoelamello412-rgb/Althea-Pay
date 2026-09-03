import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import './althea-design-system.css'
import './brand-kit.css'
import './althea-visual.css'
import './dashboard.css'
import './dashboard-responsive.css'
import './official-brand.css'
import './dashboard-polish.css'
import './sales-center.css'
import './session-actions.css'
import './brand-manual.css'
import './advanced-hub.css'
import DashboardSessionActions from '@/components/dashboard-session-actions'

export const metadata: Metadata = {
  title: 'ALTHEA PAY — Control Center',
  description: 'Central de controle, inteligência e operações dos seus funis.',
  icons: { icon: '/althea-mark.png', shortcut: '/althea-mark.png', apple: '/althea-mark.png' },
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="pt-BR"><body>{children}<DashboardSessionActions /></body></html>
}
