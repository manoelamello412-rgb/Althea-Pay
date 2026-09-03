'use client'

import Image from 'next/image'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Activity, BarChart3, CheckCircle2, Clock3, CreditCard, DollarSign, GitBranch, LayoutDashboard, LogOut, MessageSquare, Package, Plug, Radio, Search, Settings, ShieldCheck, ShoppingCart, Tag, Users, WalletCards, X } from 'lucide-react'
import { ALTHEA_PAY } from '@/lib/althea'
import { hydrateAltheaBrand } from '@/components/brand-kit'
import { BrandPillars, RevenueChart, VirtualCard } from '@/components/althea-visual-system'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Module = 'Visão geral' | 'Funis' | 'Produtos' | 'Gateways' | 'Vendas' | 'Clientes' | 'Chats' | 'Analytics' | 'Integrações' | 'Configurações'
type Row = { id: string; data?: Record<string, unknown> | null; nome?: string | null; name?: string | null; provider?: string | null; status?: string | null; url?: string | null; endpoint?: string | null; created_at?: string; [key: string]: unknown }
type Transaction = { id: string; amount: number | null; status: string | null; currency: string | null; created_at?: string; gateway_id?: string | null; funnel_id?: string | null; customer?: Record<string, unknown> | null; external_id?: string | null; transaction_id?: string | null }
type NavItem = { label: Module; icon: typeof LayoutDashboard }

const nav: NavItem[] = [
  { label: 'Visão geral', icon: LayoutDashboard },
  { label: 'Funis', icon: GitBranch },
  { label: 'Produtos', icon: Package },
  { label: 'Gateways', icon: WalletCards },
  { label: 'Vendas', icon: ShoppingCart },
  { label: 'Clientes', icon: Users },
  { label: 'Chats', icon: MessageSquare },
  { label: 'Analytics', icon: BarChart3 },
  { label: 'Integrações', icon: Plug },
  { label: 'Configurações', icon: Settings },
]

const mobileNav: NavItem[] = nav.slice(0, 5)
const tableMap: Partial<Record<Module, 'products' | 'gateways' | 'clients' | 'chats'>> = { Produtos: 'products', Gateways: 'gateways', Clientes: 'clients', Chats: 'chats' }
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

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function rowName(row: Row) {
  const data = jsonObject(row.data)
  return String(row.nome || row.name || row.provider || data.name || data.nome || data.title || row.id)
}

function customerName(customer?: Record<string, unknown> | null) {
  if (!customer) return 'Cliente não identificado'
  return String(customer.name || customer.full_name || customer.nome || customer.email || 'Cliente')
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  return (parts.slice(0, 2).map(part => part[0]).join('') || 'AP').toUpperCase()
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
  const [json, setJson] = useState('{\n  "name": "",\n  "metadata": {}\n}')
  const [saving, setSaving] = useState(false)

  async function loadAll() {
    if (!supabase) {
      setError('Supabase não configurado.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.replace('/login')
      return
    }

    setUserId(user.id)
    const profile = await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle()
    setFullName(profile.data?.display_name || user.user_metadata?.display_name || user.user_metadata?.full_name || '')

    const [f, p, g, s, c, ch, fc, e] = await Promise.all([
      supabase.from('funnels').select('id,nome,url,endpoint,status,created_at,last_communication').eq('user_id', user.id).is('deleted_at', null).order('created_at', { ascending: false }),
      supabase.from('products').select('id,data,created_at').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('gateways').select('id,data,created_at').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('sales').select('id,data,created_at,funnel_id,product_id,amount,currency,status,occurred_at,external_id,gateway_id,transaction_id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('clients').select('id,data,created_at').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('chats').select('id,data,created_at').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('funnel_connections').select('funnel_id,status,health_status').eq('user_id', user.id),
      supabase.from('integration_events').select('id,created_at,event_type,status,processed_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100),
    ])

    const errors = [f, p, g, s, c, ch, fc, e].find(item => item.error)
    if (errors?.error) setError(errors.error.message)

    setFunnels((f.data || []) as Row[])
    setCounts({ funnels: f.data?.length || 0, products: p.data?.length || 0, gateways: g.data?.length || 0, sales: s.data?.length || 0, clients: c.data?.length || 0, chats: ch.data?.length || 0 })

    const tx = (s.data || []).map((item: Record<string, unknown>) => {
      const data = jsonObject(item.data)
      return {
        id: String(item.id),
        amount: item.amount == null ? (data.amount == null ? null : Number(data.amount)) : Number(item.amount),
        status: item.status == null ? String(data.status || '') : String(item.status),
        currency: item.currency == null ? String(data.currency || 'BRL') : String(item.currency),
        created_at: String(item.occurred_at || item.created_at || ''),
        gateway_id: item.gateway_id == null ? String(data.gateway_id || '') : String(item.gateway_id),
        funnel_id: item.funnel_id == null ? String(data.funnel_id || '') : String(item.funnel_id),
        external_id: item.external_id == null ? String(data.external_id || '') : String(item.external_id),
        transaction_id: item.transaction_id == null ? String(data.transaction_id || '') : String(item.transaction_id),
        customer: jsonObject(data.customer),
      }
    })

    setTransactions(tx)
    setConnectedFunnels(new Set((fc.data || []).filter((item: Record<string, unknown>) => ['connected', 'active', 'healthy'].includes(String(item.status || item.health_status || '').toLowerCase())).map((item: Record<string, unknown>) => String(item.funnel_id))).size)
    setIntegrationEvents(e.data?.length || 0)

    const table = tableMap[active]
    if (table) setRows(((table === 'products' ? p : table === 'gateways' ? g : table === 'clients' ? c : ch).data || []) as Row[])
    setLoading(false)
  }

  useEffect(() => {
    hydrateAltheaBrand()
    loadAll()
  }, [active])

  useEffect(() => {
    if (!supabase || !userId) return
    const channel = supabase
      .channel(`althea-dashboard-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales', filter: `user_id=eq.${userId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'funnels', filter: `user_id=eq.${userId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'funnel_connections', filter: `user_id=eq.${userId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'integration_events', filter: `user_id=eq.${userId}` }, loadAll)
      .subscribe()
    const timer = window.setInterval(loadAll, 30000)
    return () => {
      window.clearInterval(timer)
      supabase.removeChannel(channel)
    }
  }, [supabase, userId])

  async function createFunnel(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !userId || !funnelName.trim()) return
    setSaving(true)
    setError('')
    const id = makeId('funnel')
    const { error: insertError } = await supabase.from('funnels').insert({ id, nome: funnelName.trim(), url: funnelUrl.trim() || null, status: 'draft', user_id: userId })
    if (insertError) setError(insertError.message)
    else {
      setMessage('Funil criado com sucesso.')
      setFunnelName('')
      setFunnelUrl('')
      await loadAll()
    }
    setSaving(false)
  }

  async function createGeneric(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !userId || !tableMap[active]) return
    setSaving(true)
    setError('')
    let input: Record<string, unknown>
    try {
      input = JSON.parse(json)
    } catch {
      setError('O JSON informado é inválido.')
      setSaving(false)
      return
    }
    const table = tableMap[active]!
    const data = { ...input, metadata: jsonObject(input.metadata) }
    const payload = { id: makeId(table.slice(0, -1)), data, user_id: userId }
    const { error: insertError } = await supabase.from(table).insert(payload)
    if (insertError) setError(insertError.message)
    else {
      setMessage(`${labels[table]} criado com sucesso.`)
      await loadAll()
    }
    setSaving(false)
  }

  async function deleteRow(table: string, id: string) {
    if (!supabase || !userId || !confirm('Excluir este registro?')) return
    const { error: deleteError } = await supabase.from(table).delete().eq('id', id).eq('user_id', userId)
    if (deleteError) setError(deleteError.message)
    else {
      setMessage('Registro excluído.')
      await loadAll()
    }
  }

  async function logout() {
    if (!supabase) return
    await supabase.auth.signOut()
    router.replace('/login')
    router.refresh()
  }

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

  const start = Date.now() - period * 86400000
  const periodTx = transactions.filter(transaction => new Date(transaction.created_at || 0).getTime() >= start)
  const approved = periodTx.filter(transaction => statusClass(transaction.status) === 'ok')
  const pending = periodTx.filter(transaction => statusClass(transaction.status) === 'pending')
  const refunded = periodTx.filter(transaction => statusClass(transaction.status) === 'warning')
  const revenue = approved.reduce((sum, transaction) => sum + (Number(transaction.amount) || 0), 0)
  const average = approved.length ? revenue / approved.length : 0
  const approvalRate = periodTx.length ? approved.length / periodTx.length * 100 : 0
  const sales = transactions.filter(transaction => {
    const query = salesQuery.trim().toLowerCase()
    return (!query || [transaction.id, transaction.gateway_id, transaction.funnel_id, transaction.external_id, customerName(transaction.customer), transaction.status].some(value => String(value || '').toLowerCase().includes(query))) && (salesStatus === 'all' || statusClass(transaction.status) === salesStatus)
  })

  function renderOverview() {
    return (
      <>
        <section className="dashboard-kpis">
          <article className="kpi-card althea-card"><div className="kpi-heading"><span>FATURAMENTO</span><span className="kpi-icon"><DollarSign size={17} /></span></div><strong>{money.format(revenue)}</strong><small>Últimos {period} dias · aprovadas</small></article>
          <article className="kpi-card althea-card"><div className="kpi-heading"><span>APROVAÇÃO</span><span className="kpi-icon"><Tag size={17} /></span></div><strong>{approvalRate.toFixed(1)}%</strong><small>{approved.length} aprovadas</small></article>
          <article className="kpi-card althea-card"><div className="kpi-heading"><span>PENDENTES</span><span className="kpi-icon"><Clock3 size={17} /></span></div><strong>{pending.length}</strong><small>aguardando processamento</small></article>
          <article className="kpi-card althea-card"><div className="kpi-heading"><span>TICKET MÉDIO</span><span className="kpi-icon"><CreditCard size={17} /></span></div><strong>{money.format(average)}</strong><small>{refunded.length} reembolsos/chargebacks</small></article>
        </section>

        <section className="dashboard-hero-row">
          <div className="revenue-card althea-card">
            <div className="revenue-top"><div><span>VISÃO DA OPERAÇÃO</span><small>Dados reais sincronizados com o banco</small></div><div className="period-switch"><button className={period === 7 ? 'selected' : ''} onClick={() => setPeriod(7)}>7D</button><button className={period === 30 ? 'selected' : ''} onClick={() => setPeriod(30)}>30D</button></div></div>
            <div className="revenue-value-row"><strong>{money.format(revenue)}</strong><span className="trend"><Activity size={14} /> operação em tempo real</span></div>
            <div className="revenue-meta"><span>{approved.length} vendas aprovadas</span><span>Atualização automática ativa</span></div>
            <RevenueChart />
          </div>
          <div className="quick-panel althea-card">
            <div className="panel-heading"><div><span>OPERAÇÃO</span><h2>Status agora</h2></div><span className="live-dot"><Radio size={11} /> LIVE</span></div>
            <div className="health-list"><div><i className="health-good" /><span>Banco de dados</span><strong>Online</strong></div><div><i className={connectedFunnels ? 'health-good' : 'health-muted'} /><span>Funis conectados</span><strong>{connectedFunnels}</strong></div><div><i className={counts.gateways ? 'health-good' : 'health-muted'} /><span>Gateways cadastrados</span><strong>{counts.gateways || 0}</strong></div><div><i className={integrationEvents ? 'health-good' : 'health-muted'} /><span>Eventos recentes</span><strong>{integrationEvents}</strong></div></div>
            <div className="dashboard-card-preview"><VirtualCard /></div>
          </div>
        </section>

        <BrandPillars />

        <section className="dashboard-lower-grid">
          <div className="dashboard-table-card althea-card">
            <div className="panel-heading"><div><span>VENDAS</span><h2>Últimas transações</h2></div><button className="text-action" onClick={() => setActive('Vendas')}>Ver todas</button></div>
            <div className="transaction-list">
              {loading ? Array.from({ length: 4 }).map((_, index) => <div className="transaction-row skeleton-row" key={index}><span className="skeleton skeleton-avatar" /><span className="skeleton-block"><i /><i /></span><span className="skeleton-block right"><i /><i /></span></div>) : transactions.slice(0, 5).map(transaction => { const customer = customerName(transaction.customer); return <div className="transaction-row" key={transaction.id} onClick={() => setSelectedTransaction(transaction)}><span className="transaction-avatar">{initials(customer)}</span><span className="transaction-main"><strong>{customer}</strong><small>{transaction.id} · {transaction.gateway_id || 'gateway não informado'}</small></span><span className="transaction-amount"><strong>{money.format(Number(transaction.amount) || 0)}</strong><span className={`status ${statusClass(transaction.status)}`}>{statusLabel(transaction.status)}</span></span></div> })}
              {!loading && transactions.length === 0 && <div className="empty-state"><strong>Nenhuma venda registrada ainda.</strong><p>Quando uma transação chegar ao banco, ela aparecerá automaticamente aqui.</p></div>}
            </div>
          </div>
          <div className="funnel-health-card althea-card">
            <div className="panel-heading"><div><span>FUNIS</span><h2>Saúde da operação</h2></div><CheckCircle2 size={18} className="icon-green" /></div>
            <div className="funnel-mini-list">{funnels.slice(0, 4).map(funnel => <div className="funnel-mini" key={funnel.id}><span className="funnel-mini-icon"><GitBranch size={15} /></span><span><strong>{rowName(funnel)}</strong><small>{String(funnel.url || funnel.endpoint || 'URL não configurada')}</small></span><span className="pill-active">{String(funnel.status || 'draft')}</span></div>)}{funnels.length === 0 && <div className="empty-state"><strong>Sem funis cadastrados.</strong><p>Crie seu primeiro funil para acompanhar conexão e eventos em tempo real.</p></div>}</div>
          </div>
        </section>
      </>
    )
  }

  function renderSales() {
    return (
      <section className="sales-center">
        <div className="sales-summary"><article className="sales-stat althea-card"><span><DollarSign size={15} />Faturamento</span><strong>{money.format(revenue)}</strong><small>Período selecionado</small></article><article className="sales-stat althea-card"><span><CheckCircle2 size={15} />Aprovadas</span><strong>{approved.length}</strong><small>Transações concluídas</small></article><article className="sales-stat althea-card"><span><Clock3 size={15} />Pendentes</span><strong>{pending.length}</strong><small>Aguardando processamento</small></article></div>
        <section className="sales-panel althea-card">
          <div className="sales-toolbar"><div><span className="sales-eyebrow">CENTRAL DE VENDAS</span><h2>Transações</h2><p>Busca e filtros aplicados sobre os dados sincronizados.</p></div><span className="althea-status"><i /> Tempo real ativo</span></div>
          <div className="sales-filters"><label className="sales-search"><Search size={15} /><input value={salesQuery} onChange={event => setSalesQuery(event.target.value)} placeholder="Buscar venda, cliente, gateway..." /></label><select value={salesStatus} onChange={event => setSalesStatus(event.target.value)}><option value="all">Todos os status</option><option value="ok">Aprovadas</option><option value="pending">Pendentes</option><option value="warning">Reembolsadas</option><option value="danger">Falhas</option></select><select value={period} onChange={event => setPeriod(Number(event.target.value) as 7 | 30)}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option></select><button className="filter-clear" onClick={() => { setSalesQuery(''); setSalesStatus('all') }}>Limpar</button></div>
          <div className="sales-mobile-list">{loading ? Array.from({ length: 5 }).map((_, index) => <div className="sales-mobile-card skeleton-card" key={index}><span className="skeleton" /><span className="skeleton wide" /><span className="skeleton" /></div>) : sales.map(transaction => <button className="sales-mobile-card" key={transaction.id} onClick={() => setSelectedTransaction(transaction)}><span className="sales-mobile-icon"><ShoppingCart size={15} /></span><span className="sales-mobile-main"><strong>{customerName(transaction.customer)}</strong><small>{transaction.id}</small><small>{transaction.gateway_id || 'Gateway não informado'}</small></span><span className="sales-mobile-right"><strong>{money.format(Number(transaction.amount) || 0)}</strong><span className={`status ${statusClass(transaction.status)}`}>{statusLabel(transaction.status)}</span></span></button>)}</div>
          <div className="sales-table-wrap"><table className="sales-table"><thead><tr><th>Transação</th><th>Cliente</th><th>Status</th><th>Valor</th><th>Data</th></tr></thead><tbody>{loading ? Array.from({ length: 6 }).map((_, index) => <tr key={index}><td colSpan={5}><div className="table-skeleton"><span /><span /><span /></div></td></tr>) : sales.map(transaction => <tr key={transaction.id} onClick={() => setSelectedTransaction(transaction)}><td><strong>{transaction.id}</strong><small>{transaction.external_id || transaction.transaction_id || 'ID externo não informado'}</small></td><td><strong>{customerName(transaction.customer)}</strong><small>{transaction.funnel_id || 'Funil não informado'}</small></td><td><span className={`status ${statusClass(transaction.status)}`}>{statusLabel(transaction.status)}</span></td><td className="sales-value">{money.format(Number(transaction.amount) || 0)}</td><td>{transaction.created_at ? dateTime.format(new Date(transaction.created_at)) : '—'}</td></tr>)}</tbody></table></div>
          {!loading && sales.length === 0 && <div className="empty-state"><strong>Nenhuma venda encontrada.</strong><p>Ajuste a busca ou os filtros para visualizar outras transações.</p></div>}
        </section>
      </section>
    )
  }

  function renderGeneric() {
    const table = tableMap[active]
    if (!table) return <section className="analytics-grid"><article className="althea-card"><span>{active.toUpperCase()}</span><strong>{active === 'Analytics' ? `${approvalRate.toFixed(1)}%` : active === 'Integrações' ? integrationEvents : '—'}</strong><small>{descriptions[active]}</small></article><article className="althea-card"><span>OPERAÇÃO</span><strong>{counts.funnels || 0}</strong><small>Funis disponíveis</small></article><article className="althea-card"><span>STATUS</span><strong>LIVE</strong><small>Sincronização automática</small></article></section>
    return <section className="records-panel althea-card"><div className="panel-heading"><div><span>{active.toUpperCase()}</span><h2>Registros</h2></div><span className="record-count">{rows.length} registros</span></div><form className="record-create" onSubmit={createGeneric}><textarea value={json} onChange={event => setJson(event.target.value)} rows={5} aria-label={`JSON de ${active}`} /><button className="primary" type="submit" disabled={saving}>{saving ? 'Salvando...' : `Adicionar ${labels[table]}`}</button></form><div className="records">{rows.map(row => <div className="record" key={row.id}><div><strong>{rowName(row)}</strong><small>{row.id}{row.created_at ? ` · ${dateTime.format(new Date(row.created_at))}` : ''}</small></div><button className="danger" onClick={() => deleteRow(table, row.id)}>Excluir</button></div>)}{rows.length === 0 && <div className="empty-state"><strong>Nenhum registro encontrado.</strong><p>Os novos registros aparecerão aqui após serem gravados no banco.</p></div>}</div></section>
  }

  return (
    <main className="althea-app">
      <aside className="althea-sidebar">
        <div className="app-brand"><Image src="/althea-pay-lockup.svg" alt="Althea Pay" width={340} height={100} priority /></div>
        <nav className="althea-nav">{nav.map(({ label, icon: Icon }) => <button key={label} className={active === label ? 'active' : ''} onClick={() => { setActive(label); setMessage(''); setError('') }}><Icon size={17} /><span>{label}</span></button>)}</nav>
        <button className="auth-switch sidebar-logout" onClick={logout}><LogOut size={15} /> Sair da conta</button>
      </aside>

      <section className="althea-main">
        <header className="althea-header dashboard-header"><div><div className="althea-kicker">{ALTHEA_PAY.tagline}</div><h1>{active === 'Visão geral' ? (fullName ? `Olá, ${fullName.split(' ')[0]}` : 'Visão geral') : active}</h1><p>{descriptions[active]}</p></div><div className="dashboard-header-actions"><div className="althea-status"><i /> <span>{loading ? 'Sincronizando' : 'Tempo real ativo'}</span></div></div></header>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {message && <div className="auth-message" role="status">{message}</div>}
        {active === 'Visão geral' && renderOverview()}
        {active === 'Vendas' && renderSales()}
        {!['Visão geral', 'Vendas'].includes(active) && renderGeneric()}
      </section>

      <nav className="mobile-bottom-nav" aria-label="Navegação principal">{mobileNav.map(({ label, icon: Icon }) => <button key={label} className={active === label ? 'active' : ''} onClick={() => { setActive(label); setMessage(''); setError('') }}><Icon size={18} /><span>{label}</span></button>)}</nav>

      {selectedTransaction && <div className="sales-modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setSelectedTransaction(null) }}><section className="sales-modal" role="dialog" aria-modal="true" aria-label="Detalhes da venda"><button className="sales-modal-close" onClick={() => setSelectedTransaction(null)} aria-label="Fechar"><X size={20} /></button><span className="sales-eyebrow">DETALHE DA TRANSAÇÃO</span><h2>{money.format(Number(selectedTransaction.amount) || 0)}</h2><span className={`status ${statusClass(selectedTransaction.status)}`}>{statusLabel(selectedTransaction.status)}</span><div className="sales-detail-grid"><div><small>Transação</small><strong>{selectedTransaction.id}</strong></div><div><small>Cliente</small><strong>{customerName(selectedTransaction.customer)}</strong></div><div><small>Gateway</small><strong>{selectedTransaction.gateway_id || '—'}</strong></div><div><small>Funil</small><strong>{selectedTransaction.funnel_id || '—'}</strong></div><div><small>ID externo</small><strong>{selectedTransaction.external_id || '—'}</strong></div><div><small>Data</small><strong>{selectedTransaction.created_at ? dateTime.format(new Date(selectedTransaction.created_at)) : '—'}</strong></div></div><div className="modal-security"><ShieldCheck size={15} /> Dados apresentados conforme as permissões da sua conta.</div></section></div>}
    </main>
  )
}
