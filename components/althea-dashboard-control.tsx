'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowRight, CalendarDays, Clock3, Eye, EyeOff, Network, ShoppingBag, Wifi, WifiOff } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Gender = 'M' | 'F' | 'outro'
type Gateway = { gateway_code: string; gateway_name: string; is_operational: boolean; latency_ms: number | null; circuit_state: string; checked_at: string }
type Metrics = { revenue: number; paidSales: number; waitingPix: number; checkoutHits: number; conversionRate: number; gateways: Gateway[]; measuredAt: string | null }
type SyncState = 'loading' | 'synchronized' | 'empty' | 'error' | 'reconnecting' | 'unauthorized'

const TZ = 'America/Sao_Paulo'
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const timeFormatter = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'medium' })
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(value)
const today = () => dateFormatter.format(new Date())
const parseLocalDate = (value: string) => { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d) }
const isoDate = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
const minDate = () => { const date = parseLocalDate(today()); date.setDate(date.getDate() - 90); return isoDate(date) }
const firstName = (value: string) => value.trim().split(/\s+/)[0] || 'Usuário'

export default function AltheaDashboardControl() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [selectedDate, setSelectedDate] = useState(today)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [name, setName] = useState('Usuário')
  const [gender, setGender] = useState<Gender>('outro')
  const [muted, setMuted] = useState(false)
  const [sync, setSync] = useState<SyncState>('loading')
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)

  const loadProfile = useCallback(async () => {
    const { data: auth, error } = await supabase.auth.getUser()
    if (error) throw error
    if (!auth.user) return false
    const { data: profile, error: profileError } = await supabase.from('profiles').select('display_name,full_name,gender').eq('id', auth.user.id).maybeSingle()
    if (profileError) throw profileError
    const metadata = auth.user.user_metadata as Record<string, unknown>
    const profileName = profile?.display_name || profile?.full_name || metadata.display_name || metadata.name || auth.user.email || 'Usuário'
    setName(firstName(String(profileName)))
    const value = profile?.gender ?? metadata.gender
    setGender(value === 'M' || value === 'F' ? value : 'outro')
    return true
  }, [supabase])

  const loadMetrics = useCallback(async (silent = false) => {
    setSync(silent ? 'reconnecting' : 'loading')
    try {
      const authenticated = await loadProfile()
      if (!authenticated) { setSync('unauthorized'); setMetrics(null); setLastUpdated(null); return }
      const { data, error } = await supabase.rpc('dashboard_metrics_for_user', { p_start_date: selectedDate, p_end_date: selectedDate })
      if (error) throw error
      const value = data as Metrics
      setMetrics(value)
      setLastUpdated(value.measuredAt || null)
      const gateways = Array.isArray(value.gateways) ? value.gateways : []
      const hasRealData = gateways.length > 0 && (value.revenue > 0 || value.paidSales > 0 || value.waitingPix > 0 || value.checkoutHits > 0)
      setSync(hasRealData || gateways.length > 0 ? 'synchronized' : 'empty')
    } catch (cause) {
      console.error('[ALTHEA-DASHBOARD]', cause)
      setSync('error')
    }
  }, [loadProfile, selectedDate, supabase])

  useEffect(() => { void loadMetrics() }, [loadMetrics])

  useEffect(() => {
    let cancelled = false
    const channels: ReturnType<typeof supabase.channel>[] = []
    const subscribe = async () => {
      const { data: auth } = await supabase.auth.getUser()
      if (cancelled || !auth.user) return
      const refresh = () => { if (!cancelled) void loadMetrics(true) }
      for (const table of ['sales', 'checkout_sessions', 'gateway_health_snapshots', 'profiles'] as const) {
        const filter = `user_id=eq.${auth.user.id}`
        channels.push(supabase.channel(`dashboard-${table}-${auth.user.id}`).on('postgres_changes', { event: '*', schema: 'public', table, filter }, refresh).subscribe())
      }
    }
    void subscribe()
    return () => { cancelled = true; for (const channel of channels) void supabase.removeChannel(channel) }
  }, [loadMetrics, supabase])

  const greeting = gender === 'F' ? 'Seja bem-vinda' : gender === 'M' ? 'Seja bem-vindo' : 'Acompanhe sua operação em tempo real.'
  const noGateway = !metrics?.gateways?.length
  const hasRealFinancialData = !noGateway && ((metrics?.revenue ?? 0) > 0 || (metrics?.paidSales ?? 0) > 0 || (metrics?.waitingPix ?? 0) > 0 || (metrics?.checkoutHits ?? 0) > 0)
  const syncLabel: Record<SyncState, string> = { loading: 'Sincronizando', synchronized: 'Sincronizado', empty: 'Aguardando conexão', error: 'Sincronização indisponível', reconnecting: 'Reconectando', unauthorized: 'Sessão não autorizada' }
  const displayRevenue = noGateway || !hasRealFinancialData ? '—' : muted ? 'R$ ••••••' : money(metrics?.revenue ?? 0)
  const displayNumber = (value: number | undefined) => noGateway || !hasRealFinancialData ? '—' : muted ? '••••' : String(value ?? 0)
  const displayConversion = noGateway || !hasRealFinancialData ? '—' : muted ? '••••' : `${(metrics?.conversionRate ?? 0).toFixed(1).replace('.', ',')}%`
  const formattedLastUpdated = lastUpdated ? timeFormatter.format(new Date(lastUpdated)) : sync === 'loading' || sync === 'reconnecting' ? 'Sincronizando...' : '—'

  return (
    <main className="min-h-screen bg-[var(--althea-bg)] pb-28 text-white antialiased">
      <div className="mx-auto w-full max-w-[1440px] space-y-6 p-4 sm:p-6 lg:p-8">
        <section>
          <h1 className="text-[30px] font-bold tracking-tight sm:text-[34px]">Olá, {name} <span className="inline-block origin-[70%_70%] animate-[althea-wave_2.5s_ease-in-out_infinite]" aria-hidden="true">👋</span></h1>
          <p className="mt-2 text-sm text-[var(--althea-muted)]">{greeting}</p>
          <p className="mt-2 text-xs text-[#69736e]">Veja o resumo do seu desempenho!</p>
          <p className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-mono text-[#77817c]"><Clock3 size={12} aria-hidden="true" />Última atualização: {formattedLastUpdated}</p>
        </section>

        <section className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setMuted((value) => !value)} aria-label={muted ? 'Mostrar valores' : 'Ocultar valores'} className="grid h-11 w-11 place-items-center rounded-xl border border-[#0D362D] bg-[#0F1A16] text-[#A6A6A6] hover:text-white">{muted ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          <label className="flex items-center gap-2 rounded-xl border border-[#0D362D] bg-[#0F1A16] px-3 py-2.5 text-xs font-bold"><CalendarDays size={16} className="text-[#A6A6A6]" /><input type="date" value={selectedDate} min={minDate()} max={today()} onChange={(event) => setSelectedDate(event.target.value)} className="bg-transparent outline-none [color-scheme:dark]" /></label>
          <div className="ml-auto flex items-center gap-2 text-[10px] font-mono text-[#77817c]"><span className={`h-2 w-2 rounded-full ${sync === 'synchronized' ? 'bg-[#1DB854]' : sync === 'reconnecting' || sync === 'loading' ? 'animate-pulse bg-amber-400' : sync === 'error' ? 'bg-red-500' : 'bg-zinc-500'}`} />{syncLabel[sync]}</div>
        </section>

        {sync === 'error' || sync === 'unauthorized' ? <section className="flex flex-col gap-4 rounded-2xl border border-red-900/40 bg-red-950/20 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-red-300">{sync === 'unauthorized' ? 'Sua sessão não está autorizada.' : 'Não foi possível sincronizar os dados reais.'}</p><p className="mt-1 text-xs text-red-300/70">Nenhum valor fictício será exibido enquanto a fonte real estiver indisponível.</p></div><button type="button" disabled={retrying} onClick={async () => { setRetrying(true); await loadMetrics(); setRetrying(false) }} className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-xs font-bold">{retrying ? 'Sincronizando...' : 'Tentar novamente'}</button></section> : null}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Metric label="Faturamento" value={displayRevenue} icon={<ShoppingBag size={15} />} />
          <Metric label="Transações" value={displayNumber(metrics?.paidSales)} icon={<Network size={15} />} />
          <Metric label="Aprovação" value={displayConversion} icon={<ArrowRight size={15} />} />
        </section>

        {noGateway ? <section className="rounded-3xl border border-[#0D362D] bg-[linear-gradient(135deg,#0F1A16,#0B0B0D)] p-6 sm:p-8"><div className="mx-auto max-w-2xl text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-[#D4AF37]/20 bg-[#D4AF37]/[0.06] text-[#D4AF37]"><Network size={24} /></div><p className="mt-5 text-xs font-black uppercase tracking-[0.22em] text-[#A6A6A6]">Dados de pagamento</p><h2 className="mt-2 text-2xl font-bold">Nenhum Gateway conectado</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#77817c]">Conecte um Gateway para configurar credenciais, validar o ambiente e iniciar a sincronização dos dados reais do provider.</p><button type="button" onClick={() => router.push('/dashboard/gateways')} className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#1DB854] px-6 text-sm font-bold text-[#07110c] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]">CONECTAR GATEWAY <ArrowRight size={16} /></button></div></section> : null}

        {!noGateway ? <section className="rounded-2xl border border-[#0D362D] bg-[#0F1A16] p-5"><div className="flex items-center justify-between"><div><h2 className="text-xs font-black uppercase tracking-[0.15em] text-[#A6A6A6]">Dados de pagamento</h2><p className="mt-1 text-[10px] text-[#59645e]">Dados sincronizados a partir das integrações reais.</p></div><Wifi size={15} className="text-[#1DB854]" /></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{metrics?.gateways.map((gateway) => <div key={`${gateway.gateway_code}-${gateway.gateway_name}`} className="rounded-xl border border-white/[0.05] bg-[#0B0B0D] p-4"><div className="flex items-center justify-between"><span className="text-sm font-semibold">{gateway.gateway_name || gateway.gateway_code}</span><span className={`h-2 w-2 rounded-full ${gateway.is_operational ? 'bg-[#1DB854]' : 'bg-red-500'}`} /></div><p className="mt-2 text-[10px] font-mono text-[#707b75]">{gateway.is_operational ? `Operacional · ${gateway.latency_ms == null ? '—' : `${gateway.latency_ms}ms`}` : `Indisponível · ${gateway.circuit_state}`}</p></div>)}</div></section> : null}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3"><Metric label="Vendas pagas" value={displayNumber(metrics?.paidSales)} icon={<ShoppingBag size={15} />} /><Metric label="Pix pendentes" value={displayNumber(metrics?.waitingPix)} icon={<Clock3 size={15} />} /><Metric label="Checkout → venda" value={displayConversion} icon={<ArrowRight size={15} />} /></section>
      </div>
      <style jsx global>{`@keyframes althea-wave{0%,100%{transform:rotate(0deg)}10%{transform:rotate(14deg)}20%{transform:rotate(-8deg)}30%{transform:rotate(14deg)}40%{transform:rotate(-4deg)}50%{transform:rotate(10deg)}60%{transform:rotate(0deg)}}@media(prefers-reduced-motion:reduce){.animate-\[althea-wave_2\.5s_ease-in-out_infinite\]{animation:none!important}}`}</style>
    </main>
  )
}

function Metric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <article className="rounded-2xl border border-white/[0.05] bg-[#0F1A16] p-4"><span className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.06] text-[#A6A6A6]">{icon}</span><p className="mt-4 text-[10px] font-bold uppercase tracking-[0.15em] text-[#69736e]">{label}</p><p className="mt-2 text-2xl font-black">{value}</p></article>
}
