'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, TrendingUp, Zap } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { DynamicGatewayConnector } from '@/components/dynamic-gateway-connector';

type GatewayProvider = string;
type LogProvider = GatewayProvider | 'SYSTEM';
type GatewayStatus = 'OPERACIONAL' | 'FAILOVER_ATIVO' | 'INDISPONÍVEL';
type LogType = 'SUCCESS' | 'WARNING' | 'CRITICAL';

interface GatewayState {
  id: string;
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
  id: string;
  name?: string | null;
  provider?: string | null;
  status?: string | null;
  priority?: number | null;
}

const INITIAL_GATEWAYS: GatewayState[] = [];
const INITIAL_LOGS: NetworkLogEvent[] = [];

function normalizeProvider(value: string | null | undefined): GatewayProvider | null {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(normalized) ? normalized : null;
}

function normalizeStatus(value: string | null | undefined): GatewayStatus {
  const normalized = value?.trim().toUpperCase();
  if (normalized === 'FAILOVER_ATIVO' || normalized === 'FAILOVER ATIVO') return 'FAILOVER_ATIVO';
  if (normalized === 'OPERACIONAL' || normalized === 'CONNECTED' || normalized === 'ACTIVE') return 'OPERACIONAL';
  return 'INDISPONÍVEL';
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
        setGateways([]);
        setSuccessRate(null);
        return;
      }

      const { data, error } = await supabase.from('gateways').select('id,name,provider,status,priority').eq('user_id', userId).order('priority', { ascending: true });
      if (error) throw error;

      const rows = (data ?? []) as GatewayRow[];
      const mapped = rows.map((row, index): GatewayState | null => {
        const provider = normalizeProvider(row.provider ?? row.name);
        if (!provider) return null;
        const priority = Number.isFinite(row.priority) ? Number(row.priority) : index + 1;
        return {
          id: row.id,
          provider,
          priority,
          roleDescription: `[PRIORIDADE ${priority}]`,
          status: normalizeStatus(row.status),
        };
      }).filter((item): item is GatewayState => item !== null).sort((a, b) => a.priority - b.priority);

      setGateways(mapped);
      const operational = mapped.filter((gateway) => gateway.status === 'OPERACIONAL').length;
      setSuccessRate(mapped.length ? Number(((operational / mapped.length) * 100).toFixed(1)) : null);
    } catch (error) {
      appendLog({ id: `system-error-${Date.now()}`, timestamp: formatTime(new Date()), provider: 'SYSTEM', message: error instanceof Error ? `Falha ao sincronizar gateways: ${error.message}` : 'Falha ao sincronizar gateways.', type: 'CRITICAL' });
      setGateways([]);
      setSuccessRate(null);
    } finally {
      setLoading(false);
    }
  }, [appendLog, supabase]);

  useEffect(() => { void loadGatewayTelemetry(); }, [loadGatewayTelemetry]);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let active = true;
    const subscribe = async () => {
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id;
      if (!active || !userId) return;
      channel = supabase.channel(`gateway-telemetry-${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'gateways', filter: `user_id=eq.${userId}` }, (payload) => {
        const row = (payload.new ?? payload.old) as GatewayRow;
        const provider = normalizeProvider(row.provider ?? row.name);
        if (!provider || !row.id) return;
        const nextStatus = normalizeStatus(row.status);
        setGateways((current) => {
          const next = current.some((item) => item.id === row.id)
            ? current.map((item) => item.id === row.id ? { ...item, status: nextStatus, priority: Number.isFinite(row.priority) ? Number(row.priority) : item.priority } : item)
            : [...current, { id: row.id, provider, priority: Number.isFinite(row.priority) ? Number(row.priority) : current.length + 1, roleDescription: `[PRIORIDADE ${Number.isFinite(row.priority) ? Number(row.priority) : current.length + 1}]`, status: nextStatus }];
          return next.sort((a, b) => a.priority - b.priority);
        });
        appendLog({ id: `gateway-${row.id}-${Date.now()}`, timestamp: formatTime(new Date()), provider, message: `STATUS -> ${statusLabel(nextStatus)}`, type: nextStatus === 'INDISPONÍVEL' ? 'CRITICAL' : nextStatus === 'FAILOVER_ATIVO' ? 'WARNING' : 'SUCCESS' });
      }).subscribe();
    };
    void subscribe();
    return () => { active = false; if (channel) void supabase.removeChannel(channel); };
  }, [appendLog, supabase]);

  return (
    <div className="w-full space-y-7 text-white selection:bg-emerald-500 selection:text-black">
      <DynamicGatewayConnector />

      <section className="space-y-2">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-zinc-100">Status das Adquirentes <Zap className="h-5 w-5 text-emerald-400" /></h1>
        <p className="text-xs text-zinc-400"><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-zinc-500 align-middle" />Saúde operacional monitorada pelo Core.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-zinc-200">Fila de prioridade <span className="text-emerald-400">(Smart Routing)</span></h2>
        <div className="overflow-hidden rounded-xl border border-white/[0.12] bg-[#0a0a0c] divide-y divide-white/[0.08]">
          {loading ? <div className="px-4 py-8 text-center text-xs text-zinc-500">Carregando Gateways...</div> : gateways.length === 0 ? <div className="px-4 py-8 text-center text-xs text-zinc-500">Nenhum Gateway conectado. Use o conector acima para adicionar uma conexão.</div> : gateways.map((gateway, index) => (
            <div key={gateway.id} className="flex min-h-[82px] items-center justify-between gap-3 px-4 py-4">
              <div className="flex min-w-0 items-center gap-3"><span className="w-4 shrink-0 font-mono text-sm text-emerald-400">{index + 1}.</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-x-4 gap-y-1"><span className="font-semibold text-[18px] text-zinc-100">{gateway.provider}</span><span className="font-mono text-[10px] text-emerald-400">{gateway.roleDescription}</span></div></div></div>
              <div className={`flex shrink-0 items-center gap-2 text-[11px] font-medium ${gateway.status === 'INDISPONÍVEL' ? 'text-rose-400' : gateway.status === 'FAILOVER_ATIVO' ? 'text-amber-400' : 'text-emerald-400'}`}><span className={`h-2 w-2 rounded-full ${gateway.status === 'INDISPONÍVEL' ? 'bg-rose-500' : gateway.status === 'FAILOVER_ATIVO' ? 'bg-amber-500' : 'bg-emerald-500'}`} />{statusLabel(gateway.status)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-zinc-200">Métricas de resiliência <span className="text-emerald-400">(Base operacional)</span></h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="relative min-h-[150px] overflow-hidden rounded-xl border border-white/[0.12] bg-[#0a0a0c] p-5"><span className="text-[11px] uppercase text-zinc-300">Disponibilidade configurada</span><div className="mt-3 text-3xl font-semibold tracking-tight text-emerald-400">{loading || successRate === null ? '—' : `${successRate.toLocaleString('pt-BR')}%`}</div><div className="absolute bottom-5 left-5 flex items-center gap-1.5 text-xs text-zinc-400"><Activity className="h-4 w-4" /> {successRate === null ? 'Aguardando dados' : 'Calculada'}</div><TrendingUp className="absolute bottom-7 right-7 h-9 w-9 text-emerald-400 opacity-20" /></div>
          <div className="relative min-h-[150px] overflow-hidden rounded-xl border border-white/[0.12] bg-[#0a0a0c] p-5"><span className="text-[11px] uppercase text-zinc-300">Recuperações de fallback</span><div className="mt-3 text-3xl font-semibold tracking-tight text-emerald-400">—</div><div className="absolute bottom-5 left-5 text-xs text-zinc-300">Sem telemetria de fallback disponível</div><RefreshCw className="absolute bottom-7 right-7 h-8 w-8 text-emerald-400 opacity-20" /></div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-zinc-200">Log de eventos de rede <span className="text-emerald-400">(Realtime)</span></h2>
        <div className="overflow-hidden rounded-xl border border-white/[0.12] bg-[#0a0a0c] divide-y divide-white/[0.08]">{logs.length === 0 ? <div className="px-4 py-8 text-center text-xs text-zinc-500">Nenhum evento de rede registrado.</div> : logs.map((log) => <div key={log.id} className="grid grid-cols-[70px_78px_1fr] items-center gap-2 px-4 py-4 text-[10px] font-mono"><span className="text-zinc-500">{log.timestamp}</span><span className={log.provider === 'SYSTEM' ? 'text-sky-400' : 'text-emerald-400'}>[{log.provider}]</span><span className={log.type === 'CRITICAL' ? 'text-rose-400' : log.type === 'WARNING' ? 'text-amber-400' : 'text-zinc-300'}>{log.message}</span></div>)}</div>
      </section>
    </div>
  );
}
