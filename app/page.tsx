'use client'

import { useMemo, useState } from 'react'
import { ALTHEA_PAY, type FunnelSummary } from '@/lib/althea'

const demoFunnels: FunnelSummary[] = [
  { id: 'demo-1', name: 'Nenhum funil conectado', status: 'draft', gatewayName: 'Aguardando conexão' },
]

export default function DashboardPage() {
  const [active, setActive] = useState('Visão geral')
  const funnels = useMemo(() => demoFunnels, [])
  const navigation = ['Visão geral', 'Funis', 'Produtos', 'Gateways', 'Vendas', 'Clientes', 'Chats', 'Analytics', 'Integrações', 'Configurações']

  return (
    <main className="althea-app">
      <aside className="althea-sidebar">
        <div className="althea-brand">{ALTHEA_PAY.name}<span>{ALTHEA_PAY.tagline}</span></div>
        <nav className="althea-nav" aria-label="Navegação principal">
          {navigation.map((item) => <button key={item} className={active === item ? 'active' : ''} onClick={() => setActive(item)}>{item}</button>)}
        </nav>
      </aside>
      <section className="althea-main">
        <header className="althea-header">
          <div><div className="althea-kicker">{ALTHEA_PAY.tagline}</div><h1>{active}</h1><p>{ALTHEA_PAY.description}</p></div>
          <div className="althea-status">● Sistema preparado</div>
        </header>
        <div className="althea-metrics">
          {['Visitas', 'Leads', 'Vendas', 'Receita', 'Chats abertos'].map((label) => <article className="althea-card" key={label}><span>{label}</span><strong>0</strong><small>Aguardando dados reais</small></article>)}
        </div>
        <section className="althea-card althea-panel">
          <div className="panel-heading"><div><span>OPERAÇÃO</span><h2>Funis conectados</h2></div><button className="primary">+ Conectar funil</button></div>
          {funnels.map((funnel) => <div className="funnel-row" key={funnel.id}><div><strong>{funnel.name}</strong><small>{funnel.gatewayName}</small></div><span className="althea-pill">{funnel.status}</span></div>)}
        </section>
        <section className="althea-card althea-panel"><div className="panel-heading"><div><span>ATIVIDADE</span><h2>Timeline operacional</h2></div></div><div className="empty-state"><strong>Seu centro de controle está pronto.</strong><p>Quando o primeiro funil e as primeiras integrações forem conectados, eventos, vendas espelhadas e conversas aparecerão aqui em tempo real.</p></div></section>
      </section>
    </main>
  )
}
