'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ALTHEA_PAY } from '@/lib/althea'
import { hydrateAltheaBrand } from '@/components/brand-kit'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Module = 'Visão geral' | 'Funis' | 'Produtos' | 'Gateways' | 'Vendas' | 'Clientes' | 'Chats' | 'Analytics' | 'Integrações' | 'Configurações'
type Transaction = { id: string; amount: number | null; status: string | null; currency: string | null; created_at?: string; gateway_id?: string | null; funnel_id?: string | null; customer?: Record<string, unknown> | null }
type Row = { id: string; data?: Record<string, unknown>; created_at?: string; [key: string]: unknown }

const nav: Module[] = ['Visão geral', 'Funis', 'Produtos', 'Gateways', 'Vendas', 'Clientes', 'Chats', 'Analytics', 'Integrações', 'Configurações']
const tableMap: Partial<Record<Module, string>> = { Produtos: 'products', Gateways: 'gateways', Clientes: 'clients', Chats: 'chats' }
const labels: Record<string, string> = { products: 'Produtos', gateways: 'Gateways', clients: 'Clientes', chats: 'Chats' }
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
const dateTime = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function statusLabel(status?: string | null) {
  const value = (status || '').toLowerCase()
  if (['approved', 'paid', 'completed', 'success', 'succeeded'].includes(value)) return 'Aprovada'
  if (['pending', 'created', 'processing'].includes(value)) return 'Pendente'
  if (['refunded', 'chargeback'].includes(value)) return value === 'chargeback' ? 'Chargeback' : 'Reembolsada'
  if (['failed', 'cancelled', 'canceled', 'rejected'].includes(value)) return 'Falhou'
  return status || '—'
}

function statusClass(status?: string | null) {
  const value = (status || '').toLowerCase()
  if (['approved', 'paid', 'completed', 'success', 'succeeded'].includes(value)) return 'ok'
  if (['pending', 'created', 'processing'].includes(value)) return 'pending'
  if (['refunded', 'chargeback'].includes(value)) return 'warning'
  return 'danger'
}

function customerName(customer?: Record<string, unknown> | null) {
  if (!customer) return 'Cliente não identificado'
  return String(customer.name || customer.full_name || customer.nome || customer.email || 'Cliente')
}

export default function DashboardPage() {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [active, setActive] = useState<Module>('Visão geral')
  const [userId, setUserId] = useState('')
  const [fullName, setFullName] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [funnels, setFunnels] = useState<Row[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [connectedFunnels, setConnectedFunnels] = useState(0)
  const [integrationEvents, setIntegrationEvents] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [period, setPeriod] = useState<7 | 30>(7)
  const [salesQuery, setSalesQuery] = useState('')
  const [salesStatus, setSalesStatus] = useState('all')
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null)
  const [funnelName, setFunnelName] = useState('')
  const [funnelUrl, setFunnelUrl] = useState('')
  const [json, setJson] = useState('{\n  "nome": "",\n  "descricao": ""\n}')
  const [saving, setSaving] = useState(false)

  async function loadAll() {
    if (!supabase) { setError('Supabase não configurado.'); setLoading(false); return }
    setLoading(true)
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/login'); return }
    setUserId(user.id)
    const profile = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
    setFullName(profile.data?.full_name || user.user_metadata?.full_name || '')
    const [f, p, g, s, c, ch, tx, conn, events] = await Promise.all([
      supabase.from('funnels').select('id,nome,url,status,created_at,last_communication').order('created_at', { ascending: false }),
      supabase.from('products').select('id,data,created_at').order('created_at', { ascending: false }),
      supabase.from('gateways').select('id,data,created_at').order('created_at', { ascending: false }),
      supabase.from('sales').select('id,data,created_at,amount,status,occurred_at,currency,gateway_id,funnel_id,transaction_id').order('created_at', { ascending: false }).limit(100),
      supabase.from('clients').select('id,data,created_at').order('created_at', { ascending: false }),
      supabase.from('chats').select('id,data,created_at').order('created_at', { ascending: false }),
      supabase.from('gateway_transactions').select('id,amount,status,currency,created_at,completed_at,gateway_id,funnel_id,customer').order('created_at', { ascending: false }).limit(100),
      supabase.from('funnel_connections').select('id,status,health_status,event_count').order('created_at', { ascending: false }),
      supabase.from('integration_events').select('id,created_at,status').order('created_at', { ascending: false }).limit(100),
    ])
    const firstError = [f, p, g, s, c, ch, tx, conn, events].find(x => x.error)
    if (firstError?.error) setError(firstError.error.message)
    setFunnels((f.data || []) as Row[])
    setCounts({ funnels: f.data?.length || 0, products: p.data?.length || 0, gateways: g.data?.length || 0, sales: s.data?.length || 0, clients: c.data?.length || 0, chats: ch.data?.length || 0 })
    const mapped = (tx.data || []) as Transaction[]
    const fallback = (s.data || []).map((item: any): Transaction => ({
      id: item.id,
      amount: item.amount ?? (Number(item.data?.amount || 0) || null),
      status: item.status ?? item.data?.status ?? null,
      currency: item.currency ?? 'BRL',
      created_at: item.occurred_at || item.created_at,
      gateway_id: item.gateway_id,
      funnel_id: item.funnel_id,
      customer: item.data?.customer || null,
    }))
    setTransactions(mapped.length ? mapped : fallback)
    setConnectedFunnels((conn.data || []).filter((item: any) => ['active', 'healthy', 'connected'].includes(String(item.status || item.health_status || '').toLowerCase())).length)
    setIntegrationEvents(events.data?.length || 0)
    const activeTable = tableMap[active]
    if (activeTable) {
      const source: Record<string, any> = { products: p, gateways: g, clients: c, chats: ch }
      setRows((source[activeTable]?.data || []) as Row[])
    }
    setLoading(false)
  }

  useEffect(() => { hydrateAltheaBrand(); loadAll() }, [active])
  useEffect(() => {
    if (!supabase || !userId) return
    const channel = supabase.channel(`althea-dashboard-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gateway_transactions' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'funnels' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'funnel_connections' }, loadAll)
      .subscribe()
    const interval = window.setInterval(loadAll, 30000)
    return () => { window.clearInterval(interval); supabase.removeChannel(channel) }
  }, [supabase, userId])

  async function createFunnel(e: FormEvent) {
    e.preventDefault(); if (!supabase || !userId) return
    setSaving(true); setError(''); setMessage('')
    const { error: insertError } = await supabase.from('funnels').insert({ id: `ANT-${Date.now()}`, nome: funnelName, url: funnelUrl || null, status: 'draft', user_id: userId })
    if (insertError) setError(insertError.message); else { setMessage('Funil criado com sucesso.'); setFunnelName(''); setFunnelUrl(''); await loadAll() }
    setSaving(false)
  }

  async function createGeneric(e: FormEvent) {
    e.preventDefault(); if (!supabase || !userId || !tableMap[active]) return
    setSaving(true); setError(''); setMessage('')
    let data: Record<string, unknown>
    try { data = JSON.parse(json) } catch { setError('O JSON informado é inválido.'); setSaving(false); return }
    const table = tableMap[active]!
    const { error: insertError } = await supabase.from(table).insert({ id: `${table.slice(0, 3).toUpperCase()}-${Date.now()}`, data, user_id: userId })
    if (insertError) setError(insertError.message); else { setMessage(`${labels[table]} criado com sucesso.`); await loadAll() }
    setSaving(false)
  }

  async function deleteRow(table: string, id: string) {
    if (!supabase || !confirm('Excluir este registro?')) return
    const { error: deleteError } = await supabase.from(table).delete().eq('id', id)
    if (deleteError) setError(deleteError.message); else { setMessage('Registro excluído.'); await loadAll() }
  }

  async function logout() { if (!supabase) return; await supabase.auth.signOut(); router.replace('/login'); router.refresh() }

  const descriptions: Record<Module, string> = {
    'Visão geral': 'Seu centro de comando financeiro, conectado aos dados reais da operação.',
    'Funis': 'Crie, acompanhe e remova seus funis conectados.',
    'Produtos': 'Gerencie os produtos associados à sua operação.',
    'Gateways': 'Cadastre e acompanhe configurações de gateways.',
    'Vendas': 'Central de vendas com busca, filtros e detalhes em tempo real.',
    'Clientes': 'Centralize os registros dos seus clientes.',
    'Chats': 'Acompanhe os registros de atendimento e conversas.',
    'Analytics': 'Indicadores calculados diretamente dos dados disponíveis.',
    'Integrações': 'Base de integrações, eventos e webhooks da operação.',
    'Configurações': 'Perfil, conta e identidade visual da Althea Pay.',
  }

  const now = Date.now()
  const start = now - period * 86400000
  const periodTx = transactions.filter(t => new Date(t.created_at || 0).getTime() >= start)
  const approved = periodTx.filter(t => statusClass(t.status) === 'ok')
  const pending = periodTx.filter(t => statusClass(t.status) === 'pending')
  const refunded = periodTx.filter(t => statusClass(t.status) === 'warning')
  const revenue = approved.reduce((sum, t) => sum + (Number(t.amount) || 0), 0)
  const average = approved.length ? revenue / approved.length : 0
  const approvalRate = periodTx.length ? (approved.length / periodTx.length) * 100 : 0
  const sales = transactions.filter(t => {
    const q = salesQuery.trim().toLowerCase()
    const matchesQuery = !q || [t.id, t.gateway_id, t.funnel_id, customerName(t.customer), t.status].some(v => String(v || '').toLowerCase().includes(q))
    const matchesStatus = salesStatus === 'all' || statusClass(t.status) === salesStatus
    return matchesQuery && matchesStatus
  })

  return (
    <main className="althea-app">
      <aside className="althea-sidebar">
        <div className="app-brand">
          <img src="/althea-pay-lockup.svg" alt="Althea Pay" />
        </div>
        <nav className="althea-nav">{nav.map(item => <button key={item} className={active === item ? 'active' : ''} onClick={() => { setActive(item); setMessage(''); setError('') }}>{item}</button>)}</nav>
        <button className="auth-switch sidebar-logout" onClick={logout}>Sair da conta</button>
      </aside>

      <section className="althea-main">
        <header className="althea-header dashboard-header">
          <div><div className="althea-kicker">{ALTHEA_PAY.tagline}</div><h1>{active === 'Visão geral' ? (fullName ? `Olá, ${fullName.split(' ')[0]}` : 'Visão geral') : active}</h1><p>{descriptions[active]}</p></div>
          <div className="dashboard-header-actions"><button className="refresh-button" onClick={loadAll} disabled={loading}>↻ <span>{loading ? 'Atualizando' : 'Atualizar'}</span></button><div className="althea-status"><i /> {loading ? 'Sincronizando' : 'Tempo real ativo'}</div></div>
        </header>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {message && <div className="auth-message" role="status">{message}</div>}

        {active === 'Visão geral' && <>
          <section className="dashboard-kpis">
            <article className="althea-card"><span>FATURAMENTO</span><strong>{money.format(revenue)}</strong><small>Últimos {period} dias · aprovadas</small></article>
            <article className="althea-card"><span>APROVAÇÃO</span><strong>{approvalRate.toFixed(1)}%</strong><small>{approved.length} aprovadas</small></article>
            <article className="althea-card"><span>PENDENTES</span><strong>{pending.length}</strong><small>aguardando processamento</small></article>
            <article className="althea-card"><span>TICKET MÉDIO</span><strong>{money.format(average)}</strong><small>{refunded.length} reembolsos/chargebacks</small></article>
          </section>
          <section className="dashboard-hero-row">
            <div className="revenue-card althea-card"><div className="revenue-top"><div><span>VISÃO DA OPERAÇÃO</span><small>Dados reais sincronizados com o banco</small></div><div className="period-switch"><button className={period === 7 ? 'selected' : ''} onClick={() => setPeriod(7)}>7D</button><button className={period === 30 ? 'selected' : ''} onClick={() => setPeriod(30)}>30D</button></div></div><strong>{money.format(revenue)}</strong><div className="revenue-meta"><span className="trend">● Dados reais da operação</span><span>{approved.length} vendas aprovadas</span></div></div>
            <div className="quick-panel althea-card"><div className="panel-heading"><div><span>OPERAÇÃO</span><h2>Status agora</h2></div><span className="live-dot">LIVE</span></div><div className="health-list"><div><i className="health-good" /><span>Banco de dados</span><strong>Online</strong></div><div><i className={connectedFunnels ? 'health-good' : 'health-muted'} /><span>Funis conectados</span><strong>{connectedFunnels}</strong></div><div><i className={counts.gateways ? 'health-good' : 'health-muted'} /><span>Gateways cadastrados</span><strong>{counts.gateways || 0}</strong></div><div><i className={integrationEvents ? 'health-good' : 'health-muted'} /><span>Eventos recentes</span><strong>{integrationEvents}</strong></div></div></div>
          </section>
        </>}

        {active === 'Vendas' && <section className="althea-card sales-module"><div className="module-toolbar"><input value={salesQuery} onChange={e => setSalesQuery(e.target.value)} placeholder="Buscar venda, cliente, gateway..." /><select value={salesStatus} onChange={e => setSalesStatus(e.target.value)}><option value="all">Todos</option><option value="ok">Aprovadas</option><option value="pending">Pendentes</option><option value="warning">Reembolsadas</option><option value="danger">Falhas</option></select></div><div className="sales-table-wrap"><table className="sales-table"><thead><tr><th>Transação</th><th>Cliente</th><th>Status</th><th>Valor</th><th>Data</th></tr></thead><tbody>{sales.map(t => <tr key={t.id} onClick={() => setSelectedTransaction(t)}><td>{t.id}</td><td>{customerName(t.customer)}</td><td><span className={`status-badge ${statusClass(t.status)}`}>{statusLabel(t.status)}</span></td><td>{money.format(Number(t.amount) || 0)}</td><td>{t.created_at ? dateTime.format(new Date(t.created_at)) : '—'}</td></tr>)}</tbody></table>{!sales.length && <div className="empty-state">Nenhuma venda encontrada.</div>}</div></section>}

        {active === 'Funis' && <section className="module-grid"><form className="althea-card form-card" onSubmit={createFunnel}><span>NOVO FUNIL</span><input value={funnelName} onChange={e => setFunnelName(e.target.value)} placeholder="Nome do funil" required /><input value={funnelUrl} onChange={e => setFunnelUrl(e.target.value)} placeholder="URL do funil" /><button disabled={saving}>{saving ? 'Salvando...' : 'Criar funil'}</button></form><div className="althea-card"><span>FUNIS CONECTADOS</span>{funnels.map(f => <div className="list-row" key={f.id}><div><strong>{String(f.nome || f.id)}</strong><small>{String(f.status || 'draft')}</small></div><button onClick={() => deleteRow('funnels', f.id)}>Excluir</button></div>)}{!funnels.length && <div className="empty-state">Nenhum funil cadastrado.</div>}</div></section>}

        {['Produtos', 'Gateways', 'Clientes', 'Chats'].includes(active) && <section className="module-grid"><form className="althea-card form-card" onSubmit={createGeneric}><span>NOVO {labels[tableMap[active]!]?.toUpperCase()}</span><textarea value={json} onChange={e => setJson(e.target.value)} rows={8} /><button disabled={saving}>{saving ? 'Salvando...' : 'Criar registro'}</button></form><div className="althea-card"><span>{labels[tableMap[active]!]?.toUpperCase()}</span>{rows.map(row => <div className="list-row" key={row.id}><div><strong>{row.id}</strong><small>{row.created_at ? dateTime.format(new Date(row.created_at)) : '—'}</small></div><button onClick={() => deleteRow(tableMap[active]!, row.id)}>Excluir</button></div>)}{!rows.length && <div className="empty-state">Nenhum registro encontrado.</div>}</div></section>}

        {['Analytics', 'Integrações', 'Configurações'].includes(active) && <section className="module-grid"><div className="althea-card info-card"><span>{active.toUpperCase()}</span><h2>{active === 'Analytics' ? 'Performance em tempo real' : active === 'Integrações' ? 'Central de integrações' : 'Configurações da conta'}</h2><p>{descriptions[active]}</p><div className="summary-grid"><div><strong>{counts.sales || 0}</strong><small>vendas</small></div><div><strong>{counts.clients || 0}</strong><small>clientes</small></div><div><strong>{counts.products || 0}</strong><small>produtos</small></div><div><strong>{integrationEvents}</strong><small>eventos</small></div></div></div></section>}
      </section>

      {selectedTransaction && <div className="modal-backdrop" onClick={() => setSelectedTransaction(null)}><div className="transaction-modal althea-card" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={() => setSelectedTransaction(null)}>×</button><span>DETALHES DA TRANSAÇÃO</span><h2>{selectedTransaction.id}</h2><p><strong>Status:</strong> {statusLabel(selectedTransaction.status)}</p><p><strong>Valor:</strong> {money.format(Number(selectedTransaction.amount) || 0)}</p><p><strong>Cliente:</strong> {customerName(selectedTransaction.customer)}</p><p><strong>Gateway:</strong> {selectedTransaction.gateway_id || '—'}</p><p><strong>Funil:</strong> {selectedTransaction.funnel_id || '—'}</p></div></div>}
    </main>
  )
}
