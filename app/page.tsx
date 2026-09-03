'use client'

import Image from 'next/image'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Activity, BarChart3, CheckCircle2, Clock3, CreditCard, DollarSign, GitBranch, LayoutDashboard, LogOut, MessageSquare, Package, Plug, Radio, Search, Settings, ShieldCheck, ShoppingCart, Tag, Users, WalletCards, X } from 'lucide-react'
import { ALTHEA_PAY } from '@/lib/althea'
import { hydrateAltheaBrand } from '@/components/brand-kit'
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
