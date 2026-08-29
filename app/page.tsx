'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ALTHEA_PAY, type FunnelSummary } from '@/lib/althea'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Metrics = { funnels: number; products: number; sales: number; clients: number; chats: number }

const emptyMetrics: Metrics = { funnels: 0, products: 0, sales: 0, clients: 0, chats: 0 }

export default function DashboardPage() {
  const router = useRouter()
  const [active, setActive] = useState('Visão geral')
  const [loggingOut, setLoggingOut] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [funnels, setFunnels] = useState<FunnelSummary[]>([])
  const [metrics, setMetrics] = useState<Metrics>(emptyMetrics)

  useEffect(() => {
    let cancelled = false

    async function loadDashboard() {
      const supabase = createSupabaseBrowserClient()
      if (!supabase) {
        setError('Supabase não está configurado. Confira as variáveis de ambiente.')
        setLoading(false)
        return
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.replace('/login')
        return
      }

      const [funnelsResult, productsResult, salesResult, clientsResult, chatsResult] = await Promise.all([
        supabase.from('funnels').select('id,nome,url,status,created_at,last_communication').order('created_at', { ascending: false }),
        supabase.from('products').select('id', { count: 'exact', head: true }),
        supabase.from('sales').select('id', { count: 'exact', head: true }),
        supabase.from('clients').select('id', { count: 'exact', head: true }),
        supabase.from('chats').select('id', { count: 'exact', head: true }),
      ])

      if (cancelled) return

      const firstError = funnelsResult.error || productsResult.error || salesResult.error || clientsResult.error || chatsResult.error
      if (firstError) setError(firstError.message)

      setFunnels((funnelsResult.data || []).map((funnel) => ({
        id: funnel.id,
        name: funnel.nome,
        domain: funnel.url || undefined,
        status: (['draft', 'active', 'paused', 'archived'].includes(funnel.status || '') ? funnel.status : 'draft') as FunnelSummary['status'],
        gatewayName: funnel.last_communication ? 'Comunicação ativa' : 'Aguardando comunicação',
        updatedAt: funnel.last_communication || funnel.created_at || undefined,
      })))

      setMetrics({
        funnels: funnelsResult.data?.length || 0,
        products: productsResult.count || 0,
        sales: salesResult.count || 0,
        clients: clientsResult.count || 0,
        chats: chatsResult.count || 0,
      })
      setLoading(false)
    }

    loadDashboard()
    return () => { cancelled = true }
  }, [router])

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient()
    if (!supabase) return
    setLoggingOut(true)
    await supabase.auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  const navigation = ['Visão geral', 'Funis', 'Produtos', 'Gateways', 'Vendas', 'Clientes', 'Chats', 'Analytics', 'Integrações', 'Configurações']

  return (
    <main className="althea-app">
      <aside className="althea-sidebar">
        <div className="althea-brand">{ALTHEA_PAY.name}<span>{ALTHEA_PAY.tagline}</span></div>
        <nav className="althea-nav" aria-label="Navegação principal">
          {navigation.map((item) => <button key={item} className={active === item ? 'active' : ''} onClick={() => setActive(item)}>{item}</button>)}
        </nav>
        <button className="auth-switch sidebar-logout" onClick={handleLogout} disabled={loggingOut}>{loggingOut ? 'Saindo...' : 'Sair da conta'}</button>
      </aside>
      <section className="althea-main">
        <header className="althea-header">
          <div><div className="althea-kicker">{ALTHEA_PAY.tagline}</div><h1>{active}</h1><p>{ALTHEA_PAY.description}</p></div>
          <div className="althea-status">● {loading ? 'Sincronizando' : 'Dados protegidos por usuário'}</div>
        </header>

        {error && <div className="auth-error" role="alert">{error}</div>}

        <div className="althea-metrics">
          <article className="althea-card"><span>Funis</span><strong>{loading ? '—' : metrics.funnels}</strong><small>Registros do seu usuário</small></article>
          <article className="althea-card"><span>Produtos</span><strong>{loading ? '—' : metrics.products}</strong><small>Registros do seu usuário</small></article>
          <article className="althea-card"><span>Vendas</span><strong>{loading ? '—' : metrics.sales}</strong><small>Registros do seu usuário</small></article>
          <article className="althea-card"><span>Clientes</span><strong>{loading ? '—' : metrics.clients}</strong><small>Registros do seu usuário</small></article>
          <article className="althea-card"><span>Chats</span><strong>{loading ? '—' : metrics.chats}</strong><small>Registros do seu usuário</small></article>
        </div>

        <section className="althea-card althea-panel">
          <div className="panel-heading"><div><span>OPERAÇÃO</span><h2>Funis conectados</h2></div><button className="primary">+ Conectar funil</button></div>
          {loading && <div className="empty-state"><strong>Carregando dados reais…</strong></div>}
          {!loading && funnels.length === 0 && <div className="empty-state"><strong>Nenhum funil conectado</strong><p>Os funis criados para sua conta aparecerão aqui automaticamente. O RLS do Supabase impede que você veja dados de outros usuários.</p></div>}
          {!loading && funnels.map((funnel) => <div className="funnel-row" key={funnel.id}><div><strong>{funnel.name}</strong><small>{funnel.domain || funnel.gatewayName}</small></div><span className="althea-pill">{funnel.status}</span></div>)}
        </section>

        <section className="althea-card althea-panel">
          <div className="panel-heading"><div><span>ATIVIDADE</span><h2>Timeline operacional</h2></div></div>
          <div className="empty-state"><strong>Centro de controle conectado ao banco.</strong><p>Os contadores e os funis acima já são lidos diretamente do Supabase e respeitam a conta autenticada. Eventos, vendas, conversas e integrações poderão ser adicionados sem quebrar esse isolamento.</p></div>
        </section>
      </section>
    </main>
  )
}
