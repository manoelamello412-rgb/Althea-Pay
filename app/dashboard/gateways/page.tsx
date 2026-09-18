'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, Zap } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { DynamicGatewayConnector } from '@/components/dynamic-gateway-connector';

type GatewayStatus = 'OPERACIONAL' | 'INDISPONÍVEL';
type LogType = 'SUCCESS' | 'CRITICAL';

interface GatewayState { id: string; name: string; provider: string; environment: string; status: GatewayStatus }
interface NetworkLogEvent { id: string; timestamp: string; provider: string; message: string; type: LogType }
interface GatewayRow { id: string; display_name?: string | null; provider?: string | null; environment?: string | null; status?: string | null }

const normalizeProvider = (value: string | null | undefined) => value?.trim() || 'Gateway';
const normalizeStatus = (value: string | null | undefined): GatewayStatus => {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'connected' || normalized === 'degraded' ? 'OPERACIONAL' : 'INDISPONÍVEL';
};
const formatTime = (value: string | Date) => {
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '--:--:--' : date.toLocaleTimeString('pt-BR', { hour12: false });
};

export default function GatewaysManagementPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [gateways, setGateways] = useState<GatewayState[]>([]);
  const [logs, setLogs] = useState<NetworkLogEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const appendLog = useCallback((event: NetworkLogEvent) => {
    setLogs(current => [event, ...current.filter(item => item.id !== event.id)].slice(0, 12));
  }, []);

  const loadGatewayTelemetry = useCallback(async () => {
    setLoading(true);
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user?.id) {
        setGateways([]);
        return;
      }
      const { data, error } = await supabase
        .from('gateways')
        .select('id,display_name,provider,environment,status')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as GatewayRow[];
      setGateways(rows.map(row => ({
        id: row.id,
        name: normalizeProvider(row.display_name),
        provider: normalizeProvider(row.provider),
        environment: row.environment?.trim() || 'production',
        status: normalizeStatus(row.status),
      })));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'erro desconhecido';
      appendLog({
        id: `system-error-${Date.now()}`,
        timestamp: formatTime(new Date()),
        provider: 'SYSTEM',
        message: `Falha ao sincronizar gateways: ${message}`,
        type: 'CRITICAL',
      });
      setGateways([]);
    } finally {
      setLoading(false);
    }
  }, [appendLog, supabase]);

  useEffect(() => { void loadGatewayTelemetry(); }, [loadGatewayTelemetry]);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let active = true;
    const subscribe = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user?.id || !active) return;
      channel = supabase
        .channel(`gateway-telemetry-${data.user.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'gateways' }, payload => {
          const row = (payload.new ?? payload.old) as GatewayRow;
          if (!row?.id) return;
          const next: GatewayState = {
            id: row.id,
            name: normalizeProvider(row.display_name),
            provider: normalizeProvider(row.provider),
            environment: row.environment?.trim() || 'production',
            status: normalizeStatus(row.status),
          };
          setGateways(current => {
            const exists = current.some(item => item.id === row.id);
            return exists ? current.map(item => item.id === row.id ? next : item) : [next, ...current];
          });
          appendLog({
            id: `gateway-${row.id}-${Date.now()}`,
            timestamp: formatTime(new Date()),
            provider: next.name,
            message: `STATUS -> ${next.status}`,
            type: next.status === 'INDISPONÍVEL' ? 'CRITICAL' : 'SUCCESS',
          });
        })
        .subscribe();
    };
    void subscribe();
    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [appendLog, supabase]);

  const operationalCount = gateways.filter(gateway => gateway.status === 'OPERACIONAL').length;

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6 pb-32 space-y-7">
      <DynamicGatewayConnector />

      <section className="space-y-2">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-zinc-100">
          Status das Gateways <Zap className="h-5 w-5 text-emerald-400" />
        </h1>
        <p className="text-xs text-zinc-400">Conexões e saúde operacional reais. Prioridade e roteamento são definidos no contexto do funil/política.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-zinc-200">Conexões operacionais</h2>
        <div className="overflow-hidden rounded-xl border border-white/[0.12] bg-[#0a0a0c] divide-y divide-white/[0.08]">
          {loading ? (
            <div className="px-4 py-8 text-center text-xs text-zinc-500">Carregando gateways...</div>
          ) : gateways.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-zinc-500">Nenhum gateway conectado. Use o conector acima.</div>
          ) : gateways.map(gateway => (
            <div key={gateway.id} className="flex min-h-[76px] items-center justify-between gap-3 px-4 py-4">
              <div className="min-w-0">
                <div className="truncate font-semibold text-[16px] text-zinc-100">{gateway.name}</div>
                <div className="mt-1 text-[9px] font-mono uppercase text-zinc-600">{gateway.provider} · {gateway.environment}</div>
              </div>
              <div className={`flex shrink-0 items-center gap-2 text-[11px] font-medium ${gateway.status === 'INDISPONÍVEL' ? 'text-rose-400' : 'text-emerald-400'}`}>
                <span className={`h-2 w-2 rounded-full ${gateway.status === 'INDISPONÍVEL' ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                {gateway.status}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-zinc-200">Resumo operacional</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="relative min-h-[140px] overflow-hidden rounded-xl border border-white/[0.12] bg-[#0a0a0c] p-5">
            <span className="text-[11px] uppercase text-zinc-300">Conectadas</span>
            <div className="mt-3 text-3xl font-semibold tracking-tight text-emerald-400">{loading ? '—' : operationalCount}</div>
            <div className="absolute bottom-5 left-5 flex items-center gap-1.5 text-xs text-zinc-400"><Activity className="h-4 w-4" />de {gateways.length} cadastradas</div>
          </div>
          <div className="relative min-h-[140px] overflow-hidden rounded-xl border border-white/[0.12] bg-[#0a0a0c] p-5">
            <span className="text-[11px] uppercase text-zinc-300">Roteamento</span>
            <div className="mt-3 text-sm font-semibold text-zinc-200">Definido por funil</div>
            <div className="absolute bottom-5 left-5 pr-4 text-xs text-zinc-400">Esta tela não simula prioridade ou fallback.</div>
            <RefreshCw className="absolute bottom-7 right-7 h-8 w-8 text-emerald-400 opacity-20" />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-zinc-200">Eventos de rede <span className="text-emerald-400">(Realtime)</span></h2>
        <div className="overflow-hidden rounded-xl border border-white/[0.12] bg-[#0a0a0c] divide-y divide-white/[0.08]">
          {logs.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-zinc-500">Nenhum evento de rede nesta sessão.</div>
          ) : logs.map(log => (
            <div key={log.id} className="grid grid-cols-[70px_78px_1fr] items-center gap-2 px-4 py-4 text-[10px] font-mono">
              <span className="text-zinc-500">{log.timestamp}</span>
              <span className={log.provider === 'SYSTEM' ? 'text-sky-400' : 'text-emerald-400'}>[{log.provider}]</span>
              <span className={log.type === 'CRITICAL' ? 'text-rose-400' : 'text-zinc-300'}>{log.message}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
