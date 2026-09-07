'use client'

import { ChevronRight, CircleDollarSign, FileText, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

const items = [
  ['Conta & Equipe', UserRound, 'Dados da conta e membros'],
  ['Financeiro', CircleDollarSign, 'Moeda, taxas e preferências financeiras'],
  ['Checkout & Domínios', FileText, 'Checkout e domínios da operação'],
  ['Segurança & Auditoria', ShieldCheck, 'Acesso, segurança e auditoria'],
] as const

export default function SettingsMobile() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [notice, setNotice] = useState('')

  async function logout() {
    if (!db) return
    setNotice('Encerrando sessão…')
    const { error } = await db.auth.signOut()
    if (error) {
      setNotice(error.message)
      return
    }
    window.location.assign('/login')
  }

  return (
    <section className="althea-mobile-settings" aria-label="Configurações mobile">
      <main className="amsg-content">
        <h1>Configurações</h1>
        <p>Ajustes da conta</p>
        <section className="amsg-list">
          {items.map(([label, Icon, desc]) => (
            <button key={label} type="button" onClick={() => setNotice(`${label}: área pronta para configuração.`)}>
              <span className="amsg-icon"><Icon size={22} /></span>
              <span><strong>{label}</strong><small>{desc}</small></span>
              <ChevronRight size={20} />
            </button>
          ))}
          <button type="button" className="amsg-logout" onClick={() => void logout()}>
            <span className="amsg-icon"><LogOut size={22} /></span>
            <strong>Sair da Conta</strong>
            <ChevronRight size={20} />
          </button>
        </section>
        {notice && <div className="amsg-notice" role="status">{notice}</div>}
      </main>
    </section>
  )
}
