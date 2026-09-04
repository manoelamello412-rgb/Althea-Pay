'use client'

import { ArrowDownRight, ArrowUpRight, BarChart3, CreditCard, MoreHorizontal, ReceiptText, Users, WalletCards } from 'lucide-react'

export type DashboardMobileStats = {
  revenue: number
  transactions: number
  averageTicket: number
  newCustomers: number
}

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0)

export default function DashboardMobile({ stats }: { stats: DashboardMobileStats }) {
  const chart = 'M8 92 C24 88 28 72 44 78 S66 58 82 66 S106 34 122 48 S146 22 162 38 S188 30 204 18 S228 28 244 10'

  return (
    <section className="althea-mobile-dashboard" aria-label="Dashboard mobile">
      <header className="amd-header">
        <div className="amd-brand">
          <span className="amd-mark">ALTHEA</span>
          <span className="amd-pay">PAY</span>
        </div>
        <button className="amd-icon-button" aria-label="Mais opções"><MoreHorizontal size={19} /></button>
      </header>

      <div className="amd-heading">
        <span className="amd-eyebrow">CONTROL PLANE</span>
        <h1>Dashboard</h1>
        <p>Visão geral do seu negócio</p>
      </div>

      <button className="amd-period" type="button">
        <span>Todo o período</span>
        <span aria-hidden="true">⌄</span>
      </button>

      <div className="amd-kpis">
        <article className="amd-card amd-kpi">
          <span>Receita</span>
          <strong>{money(stats.revenue)}</strong>
          <small><ArrowUpRight size={12} /> Período atual</small>
        </article>
        <article className="amd-card amd-kpi">
          <span>Transações</span>
          <strong>{stats.transactions}</strong>
          <small><ReceiptText size={12} /> Total processado</small>
        </article>
        <article className="amd-card amd-kpi">
          <span>Ticket Médio</span>
          <strong>{money(stats.averageTicket)}</strong>
          <small><WalletCards size={12} /> Por transação</small>
        </article>
        <article className="amd-card amd-kpi">
          <span>Novos Clientes</span>
          <strong>{stats.newCustomers}</strong>
          <small><Users size={12} /> Novos compradores</small>
        </article>
      </div>

      <article className="amd-card amd-chart-card">
        <div className="amd-card-heading"><div><span className="amd-label">Receita ao longo do tempo</span><strong>{money(stats.revenue)}</strong></div><BarChart3 size={17} /></div>
        <svg className="amd-chart" viewBox="0 0 252 104" role="img" aria-label="Gráfico de receita ao longo do tempo" preserveAspectRatio="none">
          <path className="amd-chart-grid" d="M8 18H244 M8 44H244 M8 70H244 M8 96H244" />
          <path className="amd-chart-line" d={chart} />
          <path className="amd-chart-area" d={`${chart} L244 100 L8 100 Z`} />
        </svg>
        <div className="amd-chart-axis"><span>Início</span><span>Período atual</span></div>
      </article>

      <article className="amd-card amd-revenue-card">
        <div className="amd-section-title"><span>Fontes de Receita</span><small>Distribuição</small></div>
        <div className="amd-source-layout">
          <div className="amd-donut"><span>0%</span><small>Total</small></div>
          <div className="amd-source-list">
            {['Cartão', 'Boleto', 'Pix', 'Outros'].map((item) => <div key={item}><i /> <span>{item}</span><b>0%</b></div>)}
          </div>
        </div>
      </article>

      <article className="amd-card amd-empty-card">
        <div className="amd-section-title"><span>Transações Recentes</span><small>Ver todas</small></div>
        <div className="amd-empty-icon"><CreditCard size={21} /></div>
        <strong>Nenhuma transação encontrada</strong>
        <p>As transações recentes aparecerão aqui.</p>
        <button type="button" className="amd-secondary-button">Ir para Vendas</button>
      </article>

      <article className="amd-card amd-gateway-card">
        <div className="amd-section-title"><span>Status dos Gateways</span><small>Infraestrutura</small></div>
        <div className="amd-gateway-row"><i /><span>Gateway 01</span><b>Desconectado</b></div>
        <div className="amd-gateway-row"><i /><span>Gateway 02</span><b>Desconectado</b></div>
        <div className="amd-gateway-row"><i /><span>Gateway 03</span><b>Desconectado</b></div>
      </article>

      <div className="amd-foot-space" />
    </section>
  )
}
