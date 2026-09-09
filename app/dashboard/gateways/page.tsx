'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, TrendingUp, Zap } from 'lucide-react';
import { MobileHeaderDashboard } from '@/components/mobile-header-dashboard';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type GatewayProvider = 'STRIPE' | 'ADYEN' | 'PAGARME';
type LogProvider = GatewayProvider | 'SYSTEM';
type GatewayStatus = 'OPERACIONAL' | 'FAILOVER_ATIVO' | 'INDISPONÍVEL';
type LogType = 'SUCCESS' | 'WARNING' | 'CRITICAL';

interface GatewayState {
  provider: GatewayProvider;
  priority: number;
  roleDescription: string;
  status: GatewayStatus;
}

interface NetworkLogEvent {
  id: string;
  timestamp: string;
  provider: LogProvider;
  message: string;
  type: LogType;
}

interface GatewayRow {
  id?: string;
  name?: string | null;
  provider?: string | null;
  status?: string | null;
  priority?: number | null;
  response_time_ms?: number | null;
}

const INITIAL_GATEWAYS: GatewayState[] = [
  { provider: 'STRIPE', priority: 1, roleDescription: '[PROVEDOR PRIMÁRIO]', status: 'OPERACIONAL' },
  { provider: 'ADYEN', priority: 2, roleDescription: '[FAILOVER ATIVO]', status: 'OPERACIONAL' },
  { provider: 'PAGARME', priority: 3, roleDescription: '[CIRCUIT BREAKER]', status: 'INDISPONÍVEL' },
];

const INITIAL_LOGS: NetworkLogEvent[] = [];

function normalizeProvider(value: string | null | undefined): GatewayProvider | null {
  const normalized = value?.trim().toUpperCase();
  if (normalized === 'STRIPE' || normalized === 'ADYEN' || normalized === 'PAGARME') return normalized;
  return null;
}

function normalizeStatus(value: string | null | undefined): GatewayStatus {
  const normalized = value?.trim().toUpperCase();
  if (normalized === 'FAILOVER_ATIVO' || normalized === 'FAILOVER ATIVO') return 'FAILOVER_ATIVO';
  if (normalized === 'INDISPONÍVEL' || normalized === 'INDISPONIVEL' || normalized === 'OFFLINE' || normalized === 'DISABLED') return 'INDISPONÍVEL';
  return 'OPERACIONAL';
}

function formatTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString('pt-BR', { hour12: false });
}

function statusLabel(status: GatewayStatus): string {
  return status === 'FAILOVER_ATIVO' ? 'FAILOVER ATIVO' : status;
}

export default function GatewaysManagementPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [gateways, setGateways] = useState<GatewayState[]>(INITIAL_GATEWAYS);
  const [logs, setLogs] = useState<NetworkLogEvent[]>(INITIAL_LOGS);
  const [globalResponseTime, setGlobalResponseTime] = useState<number | null>(null);
  const [recoveredCount, setRecoveredCount] = useState<number>(0);
  const [successRate, setSuccessRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const appendLog = useCallback((event: NetworkLogEvent) => {
    setLogs((current) => [event, ...current.filter((item) => item.id !== event.id)].slice(0, 12));
  }, []);

  const loadGatewayTelemetry = useCallback(async () => {
    setLoading(true);

    try {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;

      if (!userId) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('gateways')
        .select('id,name,provider,status,priority,response_time_ms')
        .eq('user_id', userId)
        .order('priority', { ascending: true });

      if (error) throw error;

      const rows = (data ?? []) as GatewayRow[];
      const mapped = rows
        .map((row, index): GatewayState | null => {
          const provider = normalizeProvider(row.provider ?? row.name);
          if (!provider) return null;
          return {
            provider,
            priority: Number.isFinite(row.priority) ? Number(row.priority) : index + 1,
            roleDescription: index === 0 ? '[PROVEDOR PRIMÁRIO]' : index === 1 ? '[FAILOVER ATIVO]' : '[CIRCUIT BREAKER]',
            status: normalizeStatus(row.status),
          };
        })
        .filter((item): item is GatewayState => item !== null)
        .sort((a, b) => a.priority - b.priority);

      if (mapped.length > 0) setGateways(mapped);

      const responseTimes = rows
        .map((row) => Number(row.response_time_ms))
        .filter((value) => Number.isFinite(value) && value >= 0);
      if (responseTimes.length > 0) {
        setGlobalResponseTime(Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length));
      }

      const operational = mapped.filter((gateway) => gateway.status === 'OPERACIONAL').length;
      if (mapped.length > 0) setSuccessRate(Number(((operational / mapped.length) * 100).toFixed(1)));
    } catch (error) {
      appendLog({
        id: `system-error-${Date.now()}`,
        timestamp: formatTime(new Date()),
        provider: 'SYSTEM',
        message: error instanceof Error ? `Falha ao sincronizar gateways: ${error.message}` : 'Falha ao sincronizar gateways.',
        type: 'CRITICAL',
      });
    } finally {
      setLoading(false);
    }
  }, [appendLog, supabase]);

  useEffect(() => {
    void loadGatewayTelemetry();
  }, [loadGatewayTelemetry]);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let active = true;

    const subscribe = async () => {
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id;
      if (!active || !userId) return;

      channel = supabase
        .channel(`gateway-telemetry-${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'gateways', filter: `user_id=eq.${userId}` },
          (payload) => {
            const row = (payload.new ?? payload.old) as GatewayRow;
            const provider = normalizeProvider(row.provider ?? row.name);
            if (!provider) return;

            const nextStatus = normalizeStatus(row.status);
            setGateways((current) => {
              const next = current.some((item) => item.provider === provider)
                ? current.map((item) => item.provider === provider ? { ...item, status: nextStatus, priority: Number.isFinite(row.priority) ? Number(row.priority) : item.priority } : item)
                : [...current, { provider, priority: Number.isFinite(row.priority) ? Number(row.priority) : current.length + 1, roleDescription: '[CIRCUIT BREAKER]', status: nextStatus }];
              return next.sort((a, b) => a.priority - b.priority);
            });

            const response = Number(row.response_time_ms);
            if (Number.isFinite(response) && response >= 0) setGlobalResponseTime(response);

            appendLog({
              id: `gateway-${row.id ?? provider}-${Date.now()}`,
              timestamp: formatTime(new Date()),
              provider,
              message: `STATUS -> ${statusLabel(nextStatus)}`,
              type: nextStatus === 'INDISPONÍVEL' ? 'CRITICAL' : nextStatus === 'FAILOVER_ATIVO' ? 'WARNING' : 'SUCCESS',
            });
          },
        )
        .subscribe();
    };

    void subscribe();
    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [appendLog, supabase]);

  const successfulFallbacks = useMemo(() => recoveredCount, [recoveredCount]);
  const displayedSuccessRate = successRate ?? (gateways.length ? 100 : 0);

  return (
    <div className="min-h-screen bg-[#020203] text-white font-sans antialiased selection:bg-emerald-500 selection:text-black">
      <MobileHeaderDashboard pageTitle="Gateways" />

      <main className="mx-auto w-full max-w-md px-5 py-6 pb-32 space-y-7">
        <section className="space-y-2">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-zinc-100">
            Status das Adquirentes
            <Zap className="h-5 w-5 text-emerald-400" />
          </h1>
          <p className="text-xs text-zinc-400">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle shadow-[0_0_8px_#10b981]" />
            Tempo de resposta médio global:{' '}
            <span className="font-mono font-semibold text-emerald-400">{globalResponseTime === null ? '—' : `${globalResponseTime}ms`}</span>
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-[11px] font-medium uppercase tracking-wide text-zinc-200">
            Fila de prioridade <span className="text-emerald-400">(Smart Routing)</span>
          </h2>
          <div className="overflow-hidden rounded-xl border border-white/[0.12] bg-[#0a0a0c] divide-y divide-white/[0.08]">
            {gateways.map((gateway, index) => (
              <div key={gateway.provider} className="flex min-h-[82px] items-center justify-between gap-3 px-4 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-4 shrink-0 font-mono text-sm text-emerald-400">{index + 1}.</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="font-semibold text-[18px] text-zinc-100">{gateway.provider}</span>
                      <span className={`font-mono text-[10px] ${gateway.status === 'INDISPONÍVEL' ? 'text-rose-400' : gateway.status === 'FAILOVER_ATIVO' ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {gateway.roleDescription}
                      </span>
                    </div>
                  </div>
                </div>
                <div className={`flex shrink-0 items-center gap-2 text-[11px] font-medium ${gateway.status === 'INDISPONÍVEL' ? 'text-rose-400' : gateway.status === 'FAILOVER_ATIVO' ? 'text-amber-400' : 'text-emerald-400'}`}>
                  <span className={`h-2 w-2 rounded-full ${gateway.status === 'INDISPONÍVEL' ? 'bg-rose-500 shadow-[0_0_8px_#f43f5e]' : gateway.status === 'FAILOVER_ATIVO' ? 'bg-amber-500 shadow-[0_0_8px_#f59e0b]' : 'bg-emerald-500 shadow-[0_0_8px_#10b981]'}`} />
                  {statusLabel(gateway.status)}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-[11px] font-medium uppercase tracking-wide text-zinc-200">
            Métricas de resiliência <span className="text-emerald-400">(Últimas 24h)</span>
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="relative min-h-[150px] overflow-hidden rounded-xl border border-white/[0.12] bg-[#0a0a0c] p-5">
              <span className="text-[11px] uppercase text-zinc-300">Taxa de sucesso</span>
              <div className="mt-3 text-3xl font-semibold tracking-tight text-emerald-400">{loading ? '—' : `${displayedSuccessRate.toLocaleString('pt-BR')}%`}</div>
              <div className="absolute bottom-5 left-5 flex items-center gap-1.5 text-xs text-emerald-400"><Activity className="h-4 w-4" /> Estável</div>
              <TrendingUp className="absolute bottom-7 right-7 h-9 w-9 text-emerald-400 opacity-20" />
            </div>
            <div className="relative min-h-[150px] overflow-hidden rounded-xl border border-white/[0.12] bg-[#0a0a0c] p-5">
              <span className="text-[11px] uppercase text-zinc-300">Conversão fallback</span>
              <div className="mt-3 text-3xl font-semibold tracking-tight text-emerald-400">{successfulFallbacks > 0 ? '100%' : '—'}</div>
              <div className="absolute bottom-5 left-5 text-xs text-zinc-300"><span className="font-semibold text-emerald-400">{successfulFallbacks}</span> Recuperadas</div>
              <RefreshCw className="absolute bottom-7 right-7 h-8 w-8 text-emerald-400 opacity-20" />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-[11px] font-medium uppercase tracking-wide text-zinc-200">
            Log de eventos de rede <span className="text-emerald-400">(Realtime)</span>
          </h2>
          <div className="overflow-hidden rounded-xl border border-white/[0.12] bg-[#0a0a0c] divide-y divide-white/[0.08]">
            {logs.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-zinc-500">Nenhum evento de rede registrado.</div>
            ) : logs.map((log) => (
              <div key={log.id} className="grid grid-cols-[70px_78px_1fr] items-center gap-2 px-4 py-4 text-[10px] font-mono">
                <span className="text-zinc-500">{log.timestamp}</span>
                <span className={log.provider === 'SYSTEM' ? 'text-sky-400' : log.provider === 'PAGARME' ? 'text-rose-400' : log.provider === 'ADYEN' ? 'text-emerald-400' : 'text-emerald-400'}>[{log.provider}]</span>
                <span className={log.type === 'CRITICAL' ? 'text-rose-400' : log.type === 'WARNING' ? 'text-amber-400' : 'text-zinc-300'}>{log.message}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      <MobileBottomNav />
    </div>
  );
}
