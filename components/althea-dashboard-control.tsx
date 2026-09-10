'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CalendarDays, Eye, EyeOff, RefreshCw, Search, Clock3, Wifi, WifiOff, ArrowRight, LayoutDashboard, ShoppingBag } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Gender = 'M' | 'F' | 'outro'
type Gateway = { gateway_code: string; gateway_name: string; is_operational: boolean; latency_ms: number | null; circuit_state: string; checked_at: string }
type Metrics = { revenue: number; paidSales: number; waitingPix: number; checkoutHits: number; conversionRate: number; gateways: Gateway[]; measuredAt: string }
type SyncState = 'loading' | 'synchronized' | 'empty' | 'error' | 'reconnecting' | 'stale' | 'unauthorized'

const TZ = 'America/Sao_Paulo'
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0)
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const timeFormatter = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'medium' })
function today(): string { return dateFormatter.format(new Date()) }
function parseLocalDate(value: string): Date { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d) }
function isoDate(value: Date): string { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` }
function minDate(): string { const date = parseLocalDate(today()); date.setDate(date.getDate() - 90); return isoDate(date) }
function firstName(value: string): string { return value.trim().split(/\s+/)[0] || 'Usuário' }

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
    const profileName = profile?.display_name || profile?.full_name || auth.user.user_metadata?.display_name || auth.user.user_metadata?.name || auth.user.email || 'Usuário'
    setName(firstName(String(profileName)))
    const value = profile?.gender
    setGender(value === 'M' || value === 'F' ? value : 'outro')
    return true
  }, [supabase])

  const loadMetrics = useCallback(async (silent = false) => {
    if (!silent) setSync('loading')
    else setSync('reconnecting')
    try {
      const authenticated = await loadProfile()
      if (!authenticated) { setSync('unauthorized'); setMetrics(null); return }
      const { data, error } = await supabase.rpc('dashboard_metrics_for_user', { p_start_date: selectedDate, p_end_date: selectedDate })
      if (error) throw error
      const value = data as Metrics
      setMetrics(value)
      setLastUpdated(value.measuredAt || new Date().toISOString())
      const hasData = value.revenue > 0 || value.paidSales > 0 || value.waitingPix > 0 || value.checkoutHits > 0 || value.gateways.length > 0
      setSync(hasData ? 'synchronized' : 'empty')
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
      const tables = ['sales', 'checkout_sessions', 'gateway_health_snapshots', 'profiles'] as const
      for (const table of tables) {
        const filter = table === 'profiles' || table === 'sales' || table === 'checkout_sessions' || table === 'gateway_health_snapshots' ? `user_id=eq.${auth.user.id}` : undefined
        const config = { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) } as const
        channels.push(supabase.channel(`dashboard-${table}-${auth.user.id}`).on('postgres_changes', config, refresh).subscribe())
      }
    }
    void subscribe()
    return () => { cancelled = true; for (const channel of channels) void supabase.removeChannel(channel) }
  }, [loadMetrics, supabase])

  const greeting = gender === 'F' ? 'Seja bem-vinda' : gender === 'M' ? 'Seja bem-vindo' : 'Seja bem-vindo(a)'
  const syncLabel: Record<SyncState, string> = { loading: 'Sincronizando', synchronized: 'Sincronizado', empty: 'Banco sem dados para este período', error: 'Sincronização indisponível', reconnecting: 'Reconectando', stale: 'Dados potencialmente desatualizados', unauthorized: 'Sessão não autorizada' }
  const displayRevenue = muted ? 'R$ ••••••' : money(metrics?.revenue ?? 0)
  const displayNumber = (value: number | undefined) => muted ? '••••' : String(value ?? 0)

  return (
    <main className="min-h-screen bg-[#0B0B0D] pb-28 text-white antialiased">
      <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
        <header className="flex items-center justify-between border-b border-[#0D362D]/50 pb-4">
          <div className="flex items-center gap-2"><div className="grid h-8 w-8 place-items-center rounded-xl border border-[#1DBB54]/20 bg-[#1DBB54]/10 text-[#1DBB54]"><LayoutDashboard size={16} /></div><span className="font-mono text-xs font-black tracking-[0.25em] text-[#A6A6A6]">ALTHEA PAY</span></div>
          <button type="button" aria-label="Buscar vendas" onClick={() => router.push('/dashboard/settings/vendas?search=')} className="rounded-xl p-2 text-[#A6A6A6] transition hover:bg-white/5 hover:text-white"><Search size={19} /></button>
        </header>

        <section>
          <div className="flex items-center gap-2"><span className="text-xs font-black uppercase tracking-[0.2em] text-[#1DBB54]">Althea Pay</span><span className="inline-block origin-[70%_70%] animate-[althea-wave_2.5s_ease-in-out_infinite]" aria-hidden="true">👋</span></div>
          <h1 className="mt-1 text-2xl font-bold">Olá, {name}</h1>
          <p className="mt-1 text-xs text-[#A6A6A6]">{greeting} onde você constrói, a sua Raiz financeira.</p>
        </section>

        <section className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setMuted((value) => !value)} aria-label={muted ? 'Mostrar valores' : 'Ocultar valores'} className="grid h-11 w-11 place-items-center rounded-xl border border-[#0D362D] bg-[#0F1A16] text-[#A6A6A6] hover:text-white">{muted ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          <label className="flex items-center gap-2 rounded-xl border border-[#0D362D] bg-[#0F1A16] px-3 py-2.5 text-xs font-bold"><CalendarDays size={16} className="text-[#A6A6A6]" /><input type="date" value={selectedDate} min={minDate()} max={today()} onChange={(event) => setSelectedDate(event.target.value)} className="bg-transparent outline-none [color-scheme:dark]" /></label>
          <div className="ml-auto flex items-center gap-2 text-[10px] font-mono text-[#77817c]"><span className={`h-2 w-2 rounded-full ${sync === 'synchronized' ? 'bg-[#1DBB54]' : sync === 'reconnecting' || sync === 'loading' ? 'animate-pulse bg-amber-400' : sync === 'error' ? 'bg-red-500' : 'bg-zinc-500'}`} />{syncLabel[sync]}</div>
        </section>

        {sync === 'error' || sync === 'unauthorized' ? <section className="flex items-center justify-between gap-4 rounded-2xl border border-red-900/40 bg-red-950/20 p-4"><div><p className="text-sm font-semibold text-red-300">{sync === 'unauthorized' ? 'Sua sessão não está autorizada.' : 'Não foi possível sincronizar os dados reais.'}</p><p className="mt-1 text-xs text-red-300/70">Nenhum valor fictício será exibido enquanto a fonte real estiver indisponível.</p></div><button type="button" disabled={retrying} onClick={async () => { setRetrying(true); await loadMetrics(); setRetrying(false) }} className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-xs font-bold">{retrying ? 'Sincronizando...' : 'Tentar'}</button></section> : null}

        <section className="rounded-2xl border border-[#0D362D] bg-[#0F1A16] p-5 shadow-inner"><div className="flex items-center justify-between"><span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#A6A6A6]">Faturamento aprovado</span><ShoppingBag size={16} className="text-[#1DBB54]" /></div><button type="button" onClick={() => router.push('/dashboard/settings/vendas')} className="mt-3 flex w-full items-end justify-between text-left"><span className={`text-3xl font-black tracking-tight text-[#1DBB54] transition ${muted ? 'blur-md select-none' : ''}`}>{displayRevenue}</span><span className="flex items-center gap-1 text-[10px] font-bold text-[#6f7b75]">Auditar vendas <ArrowRight size={13} /></span></button><p className="mt-2 text-[10px] text-[#65706a]">Dados reais registrados para {selectedDate.split('-').reverse().join('/') }.</p></section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3"><Metric label="Vendas pagas" value={displayNumber(metrics?.paidSales)} icon={<ShoppingBag size={15} />} /><Metric label="Pagamentos Pix pendentes" value={displayNumber(metrics?.waitingPix)} icon={<Clock3 size={15} />} /><Metric label="Conversão checkout → venda" value={muted ? '••••' : `${(metrics?.conversionRate ?? 0).toFixed(1).replace('.', ',')}%`} icon={<ArrowRight size={15} />} /></section>

        <section className="rounded-2xl border border-[#0D362D] bg-[#0F1A16] p-4"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-xs font-black uppercase tracking-[0.15em] text-[#A6A6A6]">Saúde das integrações</h2><p className="mt-1 text-[10px] text-[#59645e]">Somente gateways com telemetria real aparecem aqui.</p></div><Wifi size={15} className="text-[#1DBB54]" /></div>{metrics?.gateways.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{metrics.gateways.map((gateway) => <div key={`${gateway.gateway_code}-${gateway.gateway_name}`} className="rounded-xl border border-white/[0.05] bg-[#0B0B0D] p-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold">{gateway.gateway_name || gateway.gateway_code}</span><span className={`h-2 w-2 rounded-full ${gateway.is_operational ? 'bg-[#1DBB54]' : 'bg-red-500'}`} /></div><p className="mt-2 text-[10px] font-mono text-[#707b75]">{gateway.is_operational ? `Operacional · ${gateway.latency_ms ?? 0}ms` : `Indisponível · ${gateway.circuit_state}`}</p></div>)}</div> : <div className="rounded-xl border border-dashed border-[#0D362D] p-6 text-center text-xs text-[#707b75]">Nenhum gateway possui telemetria real disponível para este usuário.</div>}</section>

        <section className="flex items-center justify-between text-[10px] font-mono text-[#65706a]"><span className="flex items-center gap-1.5"><Clock3 size={13} />Última sincronização: {lastUpdated ? timeFormatter.format(new Date(lastUpdated)) : 'Sincronizando...'}</span><span className="flex items-center gap-1.5">{sync === 'synchronized' ? <Wifi size={13} className="text-[#1DBB54]" /> : <WifiOff size={13} />} {syncLabel[sync]}</span></section>
      </div>
      <style jsx global>{`@keyframes althea-wave{0%,100%{transform:rotate(0deg)}10%{transform:rotate(14deg)}20%{transform:rotate(-8deg)}30%{transform:rotate(14deg)}40%{transform:rotate(-4deg)}50%{transform:rotate(10deg)}60%{transform:rotate(0deg)}}`}</style>
    </main>
  )
}

function Metric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) { return <article className="rounded-2xl border border-white/[0.05] bg-[#0F1A16] p-4"><span className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.06] text-[#A6A6A6]">{icon}</span><p className="mt-4 text-[10px] font-bold uppercase tracking-[0.15em] text-[#69736e]">{label}</p><p className="mt-2 text-2xl font-black">{value}</p></article> }
