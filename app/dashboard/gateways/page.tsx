'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Network, RefreshCw, Router, Zap } from 'lucide-react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { DynamicGatewayConnector } from '@/components/dynamic-gateway-connector'

type GatewayStatus = 'OPERACIONAL' | 'INDISPONÍVEL'
type LogType = 'SUCCESS' | 'CRITICAL'

interface GatewayState {
  id: string
  name: string
  provider: string
  environment: string
  status: GatewayStatus
}

interface NetworkLogEvent {
  id: string
  timestamp: string
  provider: string
  message: string
  type: LogType
}

interface GatewayRow {
  id: string
  display_name?: string | null
  provider?: string | null
  environment?: string | null
  status?: string | null
}

const normalizeProvider = (value: string | null | undefined) => value?.trim() || 'Gateway'
const normalizeStatus = (value: string | null | undefined): GatewayStatus => {
  const normalized = value?.trim().toLowerCase()
  return normalized === 'connected' || normalized === 'degraded' ? 'OPERACIONAL' : 'INDISPONÍVEL'
}

const formatTime = (value: string | Date) => {
  const date = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(date.getTime()) ? '--:--:--' : date.toLocaleTimeString('pt-BR', { hour12: false })
}

export default function GatewaysManagementPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [gateways, setGateways] = useState<GatewayState[]>([])
  const [logs, setLogs] = useState<NetworkLogEvent[]>([])
  const [loading, setLoading] = useState(true)

  const appendLog = useCallback((event: NetworkLogEvent) => {
    setLogs(current => [event, ...current.filter(item => item.id !== event.id)].slice(0, 12))
  }, [])

  const loadGatewayTelemetry = useCallback(async () => {
    setLoading(true)
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError
      if (!authData.user?.id) {
        setGateways([])
        return
      }

      const { data, error } = await supabase
        .from('gateways')
        .select('id,display_name,provider,environment,status')
        .order('created_at', { ascending: false })

      if (error) throw error

      const rows = (data ?? []) as GatewayRow[]
      setGateways(rows.map(row => ({
        id: row.id,
        name: normalizeProvider(row.display_name),
        provider: normalizeProvider(row.provider),
        environment: row.environment?.trim() || 'production',
        status: normalizeStatus(row.status),
      })))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'erro desconhecido'
      appendLog({
        id: `system-error-${Date.now()}`,
        timestamp: formatTime(new Date()),
        provider: 'SYSTEM',
        message: `Falha ao sincronizar gateways: ${message}`,
        type: 'CRITICAL',
      })
      setGateways([])
    } finally {
      setLoading(false)
    }
  }, [appendLog, supabase])

  useEffect(() => { void loadGatewayTelemetry() }, [loadGatewayTelemetry])

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null
    let active = true

    const subscribe = async () => {
      const { data, error } = await supabase.auth.getUser()
      if (error || !data.user?.id || !active) return

      channel = supabase
        .channel(`gateway-telemetry-${data.user.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'gateways' }, payload => {
          const row = (payload.new ?? payload.old) as GatewayRow
          if (!row?.id) return

          const next: GatewayState = {
            id: row.id,
            name: normalizeProvider(row.display_name),
            provider: normalizeProvider(row.provider),
            environment: row.environment?.trim() || 'production',
            status: normalizeStatus(row.status),
          }

          setGateways(current => {
            const exists = current.some(item => item.id === row.id)
            return exists ? current.map(item => item.id === row.id ? next : item) : [next, ...current]
          })

          appendLog({
            id: `gateway-${row.id}-${Date.now()}`,
            timestamp: formatTime(new Date()),
            provider: next.name,
            message: `STATUS -> ${next.status}`,
            type: next.status === 'INDISPONÍVEL' ? 'CRITICAL' : 'SUCCESS',
          })
        })
        .subscribe()
    }

    void subscribe()
    return () => {
      active = false
      if (channel) void supabase.removeChannel(channel)
    }
  }, [appendLog, supabase])

  const operationalCount = gateways.filter(gateway => gateway.status === 'OPERACIONAL').length
  const unavailableCount = gateways.length - operationalCount

  return (
    <div className="w-full space-y-5">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Infraestrutura de pagamentos</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">Gateways</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--althea-muted)]">
            Conecte, teste e acompanhe provedores. Trocas globais, preflight, rollback e drift ficam na Central de Roteamento para manter uma única autoridade operacional.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 self-start lg:self-auto">
          <Link href="/dashboard/routing" className="inline-flex h-10 items-center gap-2 rounded-xl border border-[rgba(29,184,84,.16)] bg-[rgba(29,184,84,.05)] px-4 text-[10px] font-semibold text-[var(--althea-brand)] transition hover:bg-[rgba(29,184,84,.08)]">
            <Router size={14} /> Roteamento & Commands
          </Link>
          <button type="button" onClick={() => void loadGatewayTelemetry()} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[.06] bg-[var(--althea-surface)] px-4 text-[10px] font-semibold text-[var(--althea-muted)] transition hover:text-white disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Atualizar status
          </button>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Network} label="Gateways" value={loading ? '—' : String(gateways.length)} />
        <Metric icon={Activity} label="Operacionais" value={loading ? '—' : String(operationalCount)} tone="brand" />
        <Metric icon={Zap} label="Indisponíveis" value={loading ? '—' : String(unavailableCount)} tone={unavailableCount > 0 ? 'warning' : 'muted'} />
        <Metric icon={Router} label="Roteamento" value="Por funil" />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Conexões de pagamento</h2>
          <p className="mt-1 text-[10px] text-[var(--althea-muted)]">Gerencie as conexões reais sem criar uma segunda camada de configuração.</p>
        </div>
        <DynamicGatewayConnector />
      </section>

      <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Eventos de rede</h2>
            <p className="mt-1 text-[10px] text-[var(--althea-muted)]">Atualizações recebidas em tempo real durante esta sessão.</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(29,184,84,.14)] bg-[rgba(29,184,84,.055)] px-2.5 py-1 text-[8px] font-semibold text-[var(--althea-brand)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--althea-brand)] shadow-[0_0_8px_rgba(29,184,84,.65)]" />
            REALTIME
          </span>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-white/[.045] bg-[var(--althea-bg)]">
          {logs.length === 0 ? (
            <div className="grid min-h-[150px] place-items-center px-4 text-center">
              <div>
                <Activity size={20} className="mx-auto text-[var(--althea-brand)] opacity-55" />
                <p className="mt-2 text-[10px] text-[var(--althea-muted)]">Nenhum evento de rede nesta sessão.</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-white/[.035]">
              {logs.map(log => (
                <div key={log.id} className="grid gap-2 px-4 py-3.5 text-[9px] sm:grid-cols-[74px_120px_1fr] sm:items-center">
                  <span className="font-mono text-[var(--althea-muted)]">{log.timestamp}</span>
                  <span className={`font-mono ${log.provider === 'SYSTEM' ? 'text-[#D4AF37]' : 'text-[var(--althea-brand)]'}`}>[{log.provider}]</span>
                  <span className={log.type === 'CRITICAL' ? 'text-red-300' : 'text-[#aebcb5]'}>{log.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
  tone = 'muted',
}: {
  icon: typeof Activity
  label: string
  value: string
  tone?: 'brand' | 'warning' | 'muted'
}) {
  const iconTone = tone === 'brand'
    ? 'text-[var(--althea-brand)]'
    : tone === 'warning'
      ? 'text-[#D4AF37]'
      : 'text-[var(--althea-muted)]'

  return (
    <article className="min-h-[112px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] text-[var(--althea-muted)]">{label}</p>
        <Icon size={15} className={iconTone} />
      </div>
      <strong className="mt-4 block text-[24px] font-semibold tracking-[-.035em] text-white">{value}</strong>
    </article>
  )
}
