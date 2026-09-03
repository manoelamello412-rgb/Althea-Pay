'use client'

import Image from 'next/image'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Activity, BarChart3, CheckCircle2, Clock3, CreditCard, DollarSign, GitBranch, LayoutDashboard, LogOut, MessageSquare, Package, Plug, Radio, RefreshCw, Search, Settings, ShieldCheck, ShoppingCart, Tag, Users, WalletCards, X, AlertTriangle, Webhook } from 'lucide-react'
import { ALTHEA_PAY } from '@/lib/althea'
import { hydrateAltheaBrand } from '@/components/brand-kit'
import { BrandPillars, RevenueChart, VirtualCard } from '@/components/althea-visual-system'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Module = 'Visão geral' | 'Tempo real' | 'Transações' | 'Checkouts' | 'Reembolsos' | 'Chargebacks' | 'Funis' | 'Produtos' | 'Gateways' | 'Roteamento' | 'Métodos' | 'Clientes' | 'Chats' | 'Analytics' | 'Relatórios' | 'Risco' | 'APIs' | 'Webhooks' | 'Eventos' | 'Logs' | 'Conta' | 'Financeiro' | 'Checkout' | 'Integrações' | 'Notificações' | 'Segurança'
type Row = { id: string; data?: Record<string, unknown> | null; nome?: string | null; name?: string | null; provider?: string | null; status?: string | null; url?: string | null; endpoint?: string | null; created_at?: string; [key: string]: unknown }
type Transaction = { id: string; amount: number | null; status: string | null; currency: string | null; created_at?: string; gateway_id?: string | null; funnel_id?: string | null; product_id?: string | null; customer?: Record<string, unknown> | null; external_id?: string | null; transaction_id?: string | null }
type NavItem = { label: Module; icon: typeof LayoutDashboard }

const navGroups: { title: string; items: NavItem[] }[] = [
  { title: 'OPERAÇÃO', items: [
    { label: 'Visão geral', icon: LayoutDashboard }, { label: 'Tempo real', icon: Radio },
  ] },
  { title: 'VENDAS', items: [
    { label: 'Transações', icon: ShoppingCart }, { label: 'Checkouts', icon: CreditCard }, { label: 'Reembolsos', icon: RefreshCw }, { label: 'Chargebacks', icon: AlertTriangle },
  ] },
  { title: 'INFRAESTRUTURA', items: [
    { label: 'Funis', icon: GitBranch }, { label: 'Produtos', icon: Package }, { label: 'Gateways', icon: WalletCards }, { label: 'Roteamento', icon: GitBranch }, { label: 'Métodos', icon: CreditCard },
  ] },
  { title: 'RELACIONAMENTO', items: [
    { label: 'Clientes', icon: Users }, { label: 'Chats', icon: MessageSquare },
  ] },
  { title: 'INTELIGÊNCIA', items: [
    { label: 'Analytics', icon: BarChart3 }, { label: 'Relatórios', icon: BarChart3 }, { label: 'Risco', icon: ShieldCheck },
  ] },
  { title: 'INTEGRAÇÕES', items: [
    { label: 'APIs', icon: Plug }, { label: 'Webhooks', icon: Webhook }, { label: 'Eventos', icon: Activity }, { label: 'Logs', icon: Search },
  ] },
  { title: 'CONFIGURAÇÕES', items: [
    { label: 'Conta', icon: Users }, { label: 'Financeiro', icon: DollarSign }, { label: 'Checkout', icon: CreditCard }, { label: 'Integrações', icon: Plug }, { label: 'Notificações', icon: MessageSquare }, { label: 'Segurança', icon: ShieldCheck },
  ] },
]
const allNav = navGroups.flatMap(group => group.items)
const tableMap: Partial<Record<Module, 'products' | 'gateways' | 'clients' | 'chats'>> = { Produtos: 'products', Gateways: 'gateways', Clientes: 'clients', Chats: 'chats' }
const labels: Record<string, string> = { products: 'Produtos', gateways: 'Gateways', clients: 'Clientes', chats: 'Chats' }
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
const dateTime = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function statusLabel(status?: string | null) {
  const value = (status || '').toLowerCase()
  if (['approved', 'paid', 'completed', 'success', 'succeeded'].includes(value)) return 'Aprovada'
  if (['pending', 'created', 'processing'].includes(value)) return 'Pendente'
  if (value === 'refunded') return 'Reembolsada'
  if (value === 'chargeback') return 'Chargeback'
  if (['failed', 'cancelled', 'canceled', 'rejected', 'declined', 'error'].includes(value)) return 'Falhou'
  return status || '—'
}
function statusClass(status?: string | null) {
  const value = (status || '').toLowerCase()
  if (['approved', 'paid', 'completed', 'success', 'succeeded'].includes(value)) return 'ok'
  if (['pending', 'created', 'processing'].includes(value)) return 'pending'
  if (['refunded', 'chargeback'].includes(value)) return 'warning'
  return 'danger'
}
function jsonObject(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function rowName(row: Row) { const data = jsonObject(row.data); return String(row.nome || row.name || row.provider || data.name || data.nome || data.title || row.id) }
function customerName(customer?: Record<string, unknown> | null) { if (!customer) return 'Cliente não identificado'; return String(customer.name || customer.full_name || customer.nome || customer.email || 'Cliente') }
function makeId(prefix: string) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }
function initials(value: string) { const parts = value.trim().split(/\s+/).filter(Boolean); return (parts.slice(0, 2).map(part => part[0]).join('') || 'AP').toUpperCase() }

export default function DashboardPage() {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [active, setActive] = useState<Module>('Visão geral')
  const [userId, setUserId] = useState('')
  const [fullName, setFullName] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [funnels, setFunnels] = useState<Row[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [events, setEvents] = useState<Row[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [connectedFunnels, setConnectedFunnels] = useState(0)
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
    if (!supabase) { setError('Supabase não configurado.'); setLoading(false); return }
    setLoading(true); setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/login'); return }
    setUserId(user.id)
    const profile = await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle()
    setFullName(profile.data?.display_name || user.user_metadata?.display_name || user.user_metadata?.full_name || '')
    const [f, p, g, s, c, ch, fc, e] = await Promise.all([
      supabase.from('funnels').select('id,nome,url,endpoint,status,created_at,last_communication').eq('user_id', user.id).is('deleted_at', null).order('created_at', { ascending: false }),
      supabase.from('products').select('id,data,created_at').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('gateways').select('id,data,created_at').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('sales').select('id,data,created_at,funnel_id,product_id,amount,currency,status,occurred_at,external_id,gateway_id,transaction_id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(250),
      supabase.from('clients').select('id,data,created_at').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('chats').select('id,data,created_at').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('funnel_connections').select('funnel_id,status,health_status').eq('user_id', user.id),
      supabase.from('integration_events').select('id,created_at,event_type,status,processed_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100),
    ])
    const errors = [f, p, g, s, c, ch, fc, e].find(item => item.error)
    if (errors?.error) setError(errors.error.message)
    setFunnels((f.data || []) as Row[])
    setCounts({ funnels: f.data?.length || 0, products: p.data?.length || 0, gateways: g.data?.length || 0, sales: s.data?.length || 0, clients: c.data?.length || 0, chats: ch.data?.length || 0, events: e.data?.length || 0 })
    setEvents((e.data || []) as Row[])
    const tx = (s.data || []).map((item: Record<string, unknown>) => {
      const data = jsonObject(item.data)
      return { id: String(item.id), amount: item.amount == null ? (data.amount == null ? null : Number(data.amount)) : Number(item.amount), status: item.status == null ? String(data.status || '') : String(item.status), currency: item.currency == null ? String(data.currency || 'BRL') : String(item.currency), created_at: String(item.occurred_at || item.created_at || ''), gateway_id: item.gateway_id == null ? String(data.gateway_id || '') : String(item.gateway_id), funnel_id: item.funnel_id == null ? String(data.funnel_id || '') : String(item.funnel_id), product_id: item.product_id == null ? String(data.product_id || '') : String(item.product_id), external_id: item.external_id == null ? String(data.external_id || '') : String(item.external_id), transaction_id: item.transaction_id == null ? String(data.transaction_id || '') : String(item.transaction_id), customer: jsonObject(data.customer) }
    })
    setTransactions(tx)
    setConnectedFunnels(new Set((fc.data || []).filter((item: Record<string, unknown>) => ['connected', 'active', 'healthy'].includes(String(item.status || item.health_status || '').toLowerCase())).map((item: Record<string, unknown>) => String(item.funnel_id))).size)
    const table = tableMap[active]
    if (table) setRows(((table === 'products' ? p : table === 'gateways' ? g : table === 'clients' ? c : ch).data || []) as Row[])
    setLoading(false)
  }
  useEffect(() => { hydrateAltheaBrand(); loadAll() }, [active])
  useEffect(() => {
    if (!supabase || !userId) return
    const channel = supabase.channel(`althea-dashboard-${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'sales', filter: `user_id=eq.${userId}` }, loadAll).on('postgres_changes', { event: '*', schema: 'public', table: 'funnels', filter: `user_id=eq.${userId}` }, loadAll).on('postgres_changes', { event: '*', schema: 'public', table: 'funnel_connections', filter: `user_id=eq.${userId}` }, loadAll).on('postgres_changes', { event: '*', schema: 'public', table: 'integration_events', filter: `user_id=eq.${userId}` }, loadAll).subscribe()
    const timer = window.setInterval(loadAll, 30000)
    return () => { window.clearInterval(timer); supabase.removeChannel(channel) }
  }, [supabase, userId])
  async function createFunnel(event: FormEvent) {
    event.preventDefault(); if (!supabase || !userId || !funnelName.trim()) return
    setSaving(true); setError('')
    const { error: insertError } = await supabase.from('funnels').insert({ id: makeId('funnel'), nome: funnelName.trim(), url: funnelUrl.trim() || null, status: 'draft', user_id: userId })
    if (insertError) setError(insertError.message); else { setMessage('Funil criado com sucesso.'); setFunnelName(''); setFunnelUrl(''); await loadAll() }
    setSaving(false)
  }
  async function createGeneric(event: FormEvent) {
    event.preventDefault(); if (!supabase || !userId || !tableMap[active]) return
    setSaving(true); setError('')
    let input: Record<string, unknown>
    try { input = JSON.parse(json) } catch { setError('O JSON informado é inválido.'); setSaving(false); return }
    const table = tableMap[active]!; const data = { ...input, metadata: jsonObject(input.metadata) }
    const { error: insertError } = await supabase.from(table).insert({ id: makeId(table.slice(0, -1)), data, user_id: userId })
    if (insertError) setError(insertError.message); else { setMessage(`${labels[table]} criado com sucesso.`); await loadAll() }
    setSaving(false)
  }
  async function deleteRow(table: string, id: string) {
    if (!supabase || !userId || !confirm('Excluir este registro?')) return
    const { error: deleteError } = await supabase.from(table).delete().eq('id', id).eq('user_id', userId)
    if (deleteError) setError(deleteError.message); else { setMessage('Registro excluído.'); await loadAll() }
  }
  async function logout() { if (!supabase) return; await supabase.auth.signOut(); router.replace('/login'); router.refresh() }

  const descriptions: Record<Module, string> = {
    'Visão geral': 'Centro de comando financeiro com dados reais da operação.', 'Tempo real': 'Acompanhe vendas e eventos enquanto acontecem.', 'Transações': 'Visão operacional completa das transações.', 'Checkouts': 'Acompanhe sessões e performance dos checkouts.', 'Reembolsos': 'Transações com status de reembolso.', 'Chargebacks': 'Transações marcadas com chargeback.', 'Funis': 'Estrutura operacional, conexão e status dos seus funis.', 'Produtos': 'Catálogo de produtos associado à operação.', 'Gateways': 'Infraestrutura e gateways cadastrados.', 'Roteamento': 'Regras de escolha de gateway e fallback.', 'Métodos': 'Visão dos métodos de pagamento observados nas vendas.', 'Clientes': 'CRM financeiro com histórico disponível na operação.', 'Chats': 'Registros de atendimento e conversas.', 'Analytics': 'Indicadores calculados a partir dos dados sincronizados.', 'Relatórios': 'Visões consolidadas para acompanhamento financeiro.', 'Risco': 'Indicadores operacionais para monitoramento de risco.', 'APIs': 'Ponto de entrada para integrações da plataforma.', 'Webhooks': 'Eventos recebidos e processados pela operação.', 'Eventos': 'Eventos de integração registrados no banco.', 'Logs': 'Linha do tempo técnica dos eventos disponíveis.', 'Conta': 'Perfil e sessão da conta atual.', 'Financeiro': 'Moeda, taxas e indicadores financeiros.', 'Checkout': 'Configurações e operação de checkout.', 'Integrações': 'Hub de integrações, eventos e saúde operacional.', 'Notificações': 'Central de alertas e comunicação operacional.', 'Segurança': 'Controles e visibilidade de segurança da conta.',
  }
  const start = Date.now() - period * 86400000
  const periodTx = transactions.filter(t => new Date(t.created_at || 0).getTime() >= start)
  const approved = periodTx.filter(t => ['approved', 'paid', 'completed', 'success', 'succeeded'].includes((t.status || '').toLowerCase()))
  const pending = periodTx.filter(t => ['pending', 'created', 'processing'].includes((t.status || '').toLowerCase()))
  const refunded = periodTx.filter(t => (t.status || '').toLowerCase() === 'refunded')
  const chargebacks = periodTx.filter(t => (t.status || '').toLowerCase() === 'chargeback')
  const failed = periodTx.filter(t => statusClass(t.status) === 'danger')
  const revenue = approved.reduce((sum, t) => sum + (Number(t.amount) || 0), 0)
  const gross = periodTx.reduce((sum, t) => sum + (Number(t.amount) || 0), 0)
  const fees = periodTx.reduce((sum, t) => sum + (Number(jsonObject(t.customer).fee) || 0), 0)
  const average = approved.length ? revenue / approved.length : 0
  const approvalRate = periodTx.length ? approved.length / periodTx.length * 100 : 0
  const net = revenue - fees
  const sales = transactions.filter(t => { const q = salesQuery.trim().toLowerCase(); return (!q || [t.id, t.gateway_id, t.funnel_id, t.external_id, customerName(t.customer), t.status].some(v => String(v || '').toLowerCase().includes(q))) && (salesStatus === 'all' || statusClass(t.status) === salesStatus) })
  const activeTransactions = active === 'Transações' ? sales : active === 'Reembolsos' ? refunded : active === 'Chargebacks' ? chargebacks : transactions

  function metric(label: string, value: string, note: string, icon: typeof DollarSign = DollarSign) { const Icon = icon; return <article className="kpi-card althea-card"><div className="kpi-heading"><span>{label}</span><span className="kpi-icon"><Icon size={17} /></span></div><strong>{value}</strong><small>{note}</small></article> }
  function transactionList(list: Transaction[], limit = 6) { return <div className="transaction-list">{loading ? Array.from({ length: 5 }).map((_, i) => <div className="transaction-row skeleton-row" key={i}><span className="skeleton skeleton-avatar" /><span className="skeleton-block"><i /><i /></span><span className="skeleton-block right"><i /><i /></span></div>) : list.slice(0, limit).map(t => { const customer = customerName(t.customer); return <div className="transaction-row" key={t.id} onClick={() => setSelectedTransaction(t)}><span className="transaction-avatar">{initials(customer)}</span><span className="transaction-main"><strong>{customer}</strong><small>{t.id} · {t.gateway_id || 'gateway não informado'}</small></span><span className="transaction-amount"><strong>{money.format(Number(t.amount) || 0)}</strong><span className={`status ${statusClass(t.status)}`}>{statusLabel(t.status)}</span></span></div> })}{!loading && list.length === 0 && <div className="empty-state"><strong>Nenhum registro encontrado.</strong><p>Os dados reais da operação aparecerão aqui quando existirem.</p></div>}</div> }

  function renderOverview() { return <>
    <section className="dashboard-kpis">{metric('SALDO / VOLUME', money.format(net), `Líquido estimado · ${period} dias`, WalletCards)}{metric('FATURAMENTO BRUTO', money.format(gross), `${period} dias`, DollarSign)}{metric('LÍQUIDO', money.format(net), 'Aprovadas menos taxas disponíveis', DollarSign)}{metric('TAXAS', money.format(fees), 'Taxas disponíveis nos dados', Tag)}{metric('TICKET MÉDIO', money.format(average), `${approved.length} aprovadas`, CreditCard)}{metric('APROVAÇÃO', `${approvalRate.toFixed(1)}%`, `${approved.length} aprovadas`, CheckCircle2)}{metric('REEMBOLSOS', String(refunded.length), 'Transações reembolsadas', RefreshCw)}{metric('CHARGEBACKS', String(chargebacks.length), 'Transações em chargeback', AlertTriangle)}</section>
    <section className="dashboard-hero-row"><div className="revenue-card althea-card"><div className="revenue-top"><div><span>RECEITA</span><small>Dados reais sincronizados com o banco</small></div><div className="period-switch"><button className={period === 7 ? 'selected' : ''} onClick={() => setPeriod(7)}>7D</button><button className={period === 30 ? 'selected' : ''} onClick={() => setPeriod(30)}>30D</button></div></div><div className="revenue-value-row"><strong>{money.format(revenue)}</strong><span className="trend"><Activity size={14} /> tempo real</span></div><div className="revenue-meta"><span>{approved.length} vendas aprovadas</span><span>{pending.length} pendentes · {failed.length} falhas</span></div><RevenueChart /></div><div className="quick-panel althea-card"><div className="panel-heading"><div><span>OPERAÇÃO</span><h2>Status agora</h2></div><span className="live-dot"><Radio size={11} /> LIVE</span></div><div className="health-list"><div><i className="health-good" /><span>Banco de dados</span><strong>Online</strong></div><div><i className={connectedFunnels ? 'health-good' : 'health-muted'} /><span>Funis conectados</span><strong>{connectedFunnels}</strong></div><div><i className={counts.gateways ? 'health-good' : 'health-muted'} /><span>Gateways cadastrados</span><strong>{counts.gateways || 0}</strong></div><div><i className={events.length ? 'health-good' : 'health-muted'} /><span>Eventos recentes</span><strong>{events.length}</strong></div></div><div className="dashboard-card-preview"><VirtualCard /></div></div></section>
    <BrandPillars />
    <section className="dashboard-lower-grid"><div className="dashboard-table-card althea-card"><div className="panel-heading"><div><span>VENDAS</span><h2>Últimas transações</h2></div><button className="text-action" onClick={() => setActive('Transações')}>Ver todas</button></div>{transactionList(transactions, 5)}</div><div className="funnel-health-card althea-card"><div className="panel-heading"><div><span>FUNIS</span><h2>Saúde da operação</h2></div><CheckCircle2 size={18} className="icon-green" /></div><div className="funnel-mini-list">{funnels.slice(0, 5).map(f => <div className="funnel-mini" key={f.id}><span className="funnel-mini-icon"><GitBranch size={15} /></span><span><strong>{rowName(f)}</strong><small>{String(f.url || f.endpoint || 'URL não configurada')}</small></span><span className="pill-active">{String(f.status || 'draft')}</span></div>)}{funnels.length === 0 && <div className="empty-state"><strong>Sem funis cadastrados.</strong><p>Crie seu primeiro funil para acompanhar a operação.</p></div>}</div></div></section>
  </> }

  function renderSales() { return <section className="sales-center"><div className="sales-summary">{metric('FATURAMENTO', money.format(revenue), 'Período selecionado', DollarSign)}{metric('APROVADAS', String(approved.length), 'Transações concluídas', CheckCircle2)}{metric('PENDENTES', String(pending.length), 'Aguardando processamento', Clock3)}</div><section className="sales-panel althea-card"><div className="sales-toolbar"><div><span className="sales-eyebrow">CENTRAL DE VENDAS</span><h2>{active === 'Reembolsos' ? 'Reembolsos' : active === 'Chargebacks' ? 'Chargebacks' : 'Transações'}</h2><p>Busca e filtros aplicados sobre os dados sincronizados.</p></div><span className="althea-status"><i /> Tempo real ativo</span></div><div className="sales-filters"><label className="sales-search"><Search size={15} /><input value={salesQuery} onChange={e => setSalesQuery(e.target.value)} placeholder="Buscar venda, cliente, gateway..." /></label><select value={salesStatus} onChange={e => setSalesStatus(e.target.value)}><option value="all">Todos os status</option><option value="ok">Aprovadas</option><option value="pending">Pendentes</option><option value="warning">Reembolsadas</option><option value="danger">Falhas</option></select><select value={period} onChange={e => setPeriod(Number(e.target.value) as 7 | 30)}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option></select><button className="filter-clear" onClick={() => { setSalesQuery(''); setSalesStatus('all') }}>Limpar</button></div><div className="sales-table-wrap"><table className="sales-table"><thead><tr><th>Transação</th><th>Cliente</th><th>Status</th><th>Valor</th><th>Data</th></tr></thead><tbody>{activeTransactions.map(t => <tr key={t.id} onClick={() => setSelectedTransaction(t)}><td><strong>{t.id}</strong><small>{t.external_id || t.transaction_id || 'ID externo não informado'}</small></td><td><strong>{customerName(t.customer)}</strong><small>{t.funnel_id || 'Funil não informado'}</small></td><td><span className={`status ${statusClass(t.status)}`}>{statusLabel(t.status)}</span></td><td className="sales-value">{money.format(Number(t.amount) || 0)}</td><td>{t.created_at ? dateTime.format(new Date(t.created_at)) : '—'}</td></tr>)}</tbody></table></div>{activeTransactions.length === 0 && <div className="empty-state"><strong>Nenhuma transação encontrada.</strong><p>Não há registros compatíveis com o período e filtros atuais.</p></div>}</section></section> }

  function renderFunnel() { return <section className="dashboard-lower-grid"><section className="records-panel althea-card"><div className="panel-heading"><div><span>FUNIS</span><h2>Editor operacional</h2></div><span className="record-count">{funnels.length} funis</span></div><form className="record-create" onSubmit={createFunnel}><input value={funnelName} onChange={e => setFunnelName(e.target.value)} placeholder="Nome do funil" required /><input value={funnelUrl} onChange={e => setFunnelUrl(e.target.value)} placeholder="URL do funil (opcional)" /><button className="primary" type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Criar funil'}</button></form><div className="records">{funnels.map(f => <div className="record" key={f.id}><div><strong>{rowName(f)}</strong><small>{f.id} · {String(f.url || f.endpoint || 'URL não configurada')}</small></div><span className="pill-active">{String(f.status || 'draft')}</span></div>)}{funnels.length === 0 && <div className="empty-state"><strong>Nenhum funil cadastrado.</strong><p>Cadastre um funil para começar.</p></div>}</div></section><section className="althea-card"><div className="panel-heading"><div><span>OPERAÇÃO</span><h2>Checklist do funil</h2></div></div><div className="health-list"><div><i className="health-muted" /><span>Checkout</span><strong>Dados do banco</strong></div><div><i className="health-muted" /><span>Gateway</span><strong>Configuração real</strong></div><div><i className="health-muted" /><span>Domínio</span><strong>Configuração real</strong></div><div><i className="health-muted" /><span>Eventos</span><strong>{events.length}</strong></div></div></section></section> }

  function renderGateway() { return <section className="records-panel althea-card"><div className="panel-heading"><div><span>GATEWAYS</span><h2>Centro de infraestrutura</h2></div><span className="record-count">{rows.length} cadastrados</span></div><div className="dashboard-kpis">{metric('GATEWAYS', String(rows.length), 'Cadastrados na conta', WalletCards)}{metric('FUNIS CONECTADOS', String(connectedFunnels), 'Conexões ativas', GitBranch)}{metric('EVENTOS', String(events.length), 'Últimos eventos carregados', Activity)}</div><div className="records">{rows.map(row => { const d = jsonObject(row.data); return <div className="record" key={row.id}><div><strong>{rowName(row)}</strong><small>{row.id} · ambiente: {String(d.environment || d.mode || 'não informado')} · status: {String(row.status || d.status || 'não informado')}</small></div><span className={`status ${statusClass(String(row.status || d.status || ''))}`}>{statusLabel(String(row.status || d.status || ''))}</span></div>)}{rows.length === 0 && <div className="empty-state"><strong>Nenhum gateway cadastrado.</strong><p>Conecte um gateway para habilitar a operação.</p></div>}</div></section> }

  function renderAnalytics() { const byStatus = { approved: approved.length, pending: pending.length, failed: failed.length, refunded: refunded.length, chargebacks: chargebacks.length }; return <section className="analytics-grid"><article className="althea-card"><span>RECEITA</span><strong>{money.format(revenue)}</strong><small>{period} dias</small></article><article className="althea-card"><span>APROVAÇÃO</span><strong>{approvalRate.toFixed(1)}%</strong><small>{approved.length} aprovadas</small></article><article className="althea-card"><span>REEMBOLSO</span><strong>{byStatus.refunded}</strong><small>Transações</small></article><article className="althea-card"><span>CHARGEBACK</span><strong>{byStatus.chargebacks}</strong><small>Transações</small></article><article className="althea-card"><span>PENDENTES</span><strong>{byStatus.pending}</strong><small>Em processamento</small></article><article className="althea-card"><span>FALHAS</span><strong>{byStatus.failed}</strong><small>Necessitam análise</small></article><section className="althea-card"><div className="panel-heading"><div><span>RECEITA</span><h2>Performance por período</h2></div></div><RevenueChart /></section><section className="althea-card"><div className="panel-heading"><div><span>ATIVIDADE</span><h2>Eventos recentes</h2></div></div>{events.slice(0, 8).map(e => <div className="record" key={e.id}><div><strong>{String(e.event_type || 'Evento')}</strong><small>{e.id} · {e.created_at ? dateTime.format(new Date(e.created_at)) : '—'}</small></div><span className={`status ${statusClass(String(e.status || ''))}`}>{String(e.status || 'registrado')}</span></div>)}{events.length === 0 && <div className="empty-state"><strong>Sem eventos recentes.</strong></div>}</section></section> }

  function renderRecords() { const table = tableMap[active]; if (!table) return null; return <section className="records-panel althea-card"><div className="panel-heading"><div><span>{active.toUpperCase()}</span><h2>Registros</h2></div><span className="record-count">{rows.length} registros</span></div><form className="record-create" onSubmit={createGeneric}><textarea value={json} onChange={e => setJson(e.target.value)} rows={5} aria-label={`JSON de ${active}`} /><button className="primary" type="submit" disabled={saving}>{saving ? 'Salvando...' : `Adicionar ${labels[table]}`}</button></form><div className="records">{rows.map(row => <div className="record" key={row.id}><div><strong>{rowName(row)}</strong><small>{row.id}{row.created_at ? ` · ${dateTime.format(new Date(row.created_at))}` : ''}</small></div><button className="danger" onClick={() => deleteRow(table, row.id)}>Excluir</button></div>)}{rows.length === 0 && <div className="empty-state"><strong>Nenhum registro encontrado.</strong><p>Os novos registros aparecerão aqui após serem gravados no banco.</p></div>}</div></section> }

  function renderOperational() { const values = active === 'Roteamento' ? ['Roteamento ativo', 'Gateway primário', 'Fallback', 'Prioridade'] : active === 'Métodos' ? ['PIX', 'Cartão', 'Boleto', 'Outros'] : active === 'Risco' ? ['Aprovadas', 'Pendentes', 'Falhas', 'Chargebacks'] : ['Status', 'Última execução', 'Falhas', 'Retentativas']; return <section className="analytics-grid">{values.map((label, i) => <article className="althea-card" key={label}><span>{label.toUpperCase()}</span><strong>{i === 0 ? (active === 'Risco' ? `${approvalRate.toFixed(1)}%` : active === 'Roteamento' ? `${counts.gateways || 0}` : 'LIVE') : i === 1 ? (active === 'Logs' || active === 'Eventos' ? (events[0]?.created_at ? dateTime.format(new Date(String(events[0].created_at))) : '—') : 'Configuração real') : i === 2 ? String(failed.length) : String(events.length)}</strong><small>{descriptions[active]}</small></article>)}<section className="althea-card"><div className="panel-heading"><div><span>ATIVIDADE</span><h2>Eventos da operação</h2></div></div>{events.slice(0, 12).map(e => <div className="record" key={e.id}><div><strong>{String(e.event_type || 'Evento')}</strong><small>{e.id} · {e.created_at ? dateTime.format(new Date(e.created_at)) : '—'}</small></div><span>{String(e.status || 'registrado')}</span></div>)}{events.length === 0 && <div className="empty-state"><strong>Nenhum evento disponível.</strong><p>O painel não inventa dados: esta área será preenchida pela operação real.</p></div>}</section></section> }

  function renderSettings() { return <section className="dashboard-lower-grid"><section className="althea-card"><div className="panel-heading"><div><span>{active.toUpperCase()}</span><h2>{active === 'Conta' ? 'Conta e sessão' : descriptions[active]}</h2></div></div><div className="health-list"><div><span>Usuário</span><strong>{fullName || userId}</strong></div><div><span>Identificador</span><strong>{userId || '—'}</strong></div><div><span>Sincronização</span><strong>{loading ? 'Sincronizando' : 'Ativa'}</strong></div></div>{active === 'Conta' && <button className="auth-switch sidebar-logout" onClick={logout}><LogOut size={15} /> Sair da conta</button>}</section><section className="althea-card"><div className="panel-heading"><div><span>PRINCÍPIO</span><h2>Sem recursos fictícios</h2></div><ShieldCheck size={18} /></div><p>Controles que ainda não possuem integração real não são apresentados como concluídos. A interface reflete o estado efetivo do banco e das integrações disponíveis.</p></section></section> }

  function renderCurrent() {
    if (active === 'Visão geral') return renderOverview()
    if (['Transações', 'Reembolsos', 'Chargebacks'].includes(active)) return renderSales()
    if (active === 'Funis') return renderFunnel()
    if (active === 'Gateways') return renderGateway()
    if (['Analytics', 'Relatórios'].includes(active)) return renderAnalytics()
    if (tableMap[active]) return renderRecords()
    if (['Conta', 'Financeiro', 'Checkout', 'Integrações', 'Notificações', 'Segurança'].includes(active)) return renderSettings()
    return renderOperational()
  }

  return <main className="althea-app">
    <aside className="althea-sidebar"><div className="app-brand"><Image src="/althea-pay-lockup.svg" alt="Althea Pay" width={340} height={100} priority /></div><nav className="althea-nav">{navGroups.map(group => <div key={group.title}><div className="nav-section-title">{group.title}</div>{group.items.map(({ label, icon: Icon }) => <button key={label} className={active === label ? 'active' : ''} onClick={() => { setActive(label); setMessage(''); setError('') }}><Icon size={17} /><span>{label}</span></button>)}</div>)}</nav></aside>
    <section className="althea-main"><header className="althea-header dashboard-header"><div><div className="althea-kicker">{ALTHEA_PAY.tagline}</div><h1>{active === 'Visão geral' ? (fullName ? `Olá, ${fullName.split(' ')[0]}` : 'Visão geral') : active}</h1><p>{descriptions[active]}</p></div><div className="dashboard-header-actions"><div className="althea-status"><i /> <span>{loading ? 'Sincronizando' : 'Tempo real ativo'}</span></div></div></header>{error && <div className="auth-error" role="alert">{error}</div>}{message && <div className="auth-message" role="status">{message}</div>}{renderCurrent()}</section>
    <nav className="mobile-bottom-nav" aria-label="Navegação principal">{allNav.slice(0, 5).map(({ label, icon: Icon }) => <button key={label} className={active === label ? 'active' : ''} onClick={() => setActive(label)}><Icon size={18} /><span>{label}</span></button>)}</nav>
    {selectedTransaction && <div className="sales-modal-backdrop" role="presentation" onMouseDown={e => { if (e.currentTarget === e.target) setSelectedTransaction(null) }}><section className="sales-modal" role="dialog" aria-modal="true" aria-label="Detalhes da venda"><button className="sales-modal-close" onClick={() => setSelectedTransaction(null)} aria-label="Fechar"><X size={20} /></button><span className="sales-eyebrow">DETALHE DA TRANSAÇÃO</span><h2>{money.format(Number(selectedTransaction.amount) || 0)}</h2><span className={`status ${statusClass(selectedTransaction.status)}`}>{statusLabel(selectedTransaction.status)}</span><div className="sales-detail-grid"><div><small>Transação</small><strong>{selectedTransaction.id}</strong></div><div><small>Cliente</small><strong>{customerName(selectedTransaction.customer)}</strong></div><div><small>Produto</small><strong>{selectedTransaction.product_id || '—'}</strong></div><div><small>Gateway</small><strong>{selectedTransaction.gateway_id || '—'}</strong></div><div><small>Funil</small><strong>{selectedTransaction.funnel_id || '—'}</strong></div><div><small>ID externo</small><strong>{selectedTransaction.external_id || selectedTransaction.transaction_id || '—'}</strong></div><div><small>Data</small><strong>{selectedTransaction.created_at ? dateTime.format(new Date(selectedTransaction.created_at)) : '—'}</strong></div><div><small>Moeda</small><strong>{selectedTransaction.currency || 'BRL'}</strong></div></div><div className="modal-security"><ShieldCheck size={15} /> Dados apresentados conforme as permissões da sua conta.</div></section></div>}
  </main>
}
