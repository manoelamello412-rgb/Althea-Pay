'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, RefreshCw, ShieldCheck, Zap } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { DynamicGatewayConnector } from '@/components/dynamic-gateway-connector';
import { GlobalFunnelGatewaySwitch } from '@/components/global-funnel-gateway-switch';

type GatewayStatus = 'OPERACIONAL' | 'INDISPONÍVEL';
type LogType = 'SUCCESS' | 'CRITICAL';

interface GatewayState { id: string; name: string; provider: string; environment: string; status: GatewayStatus; rawStatus: string }
interface NetworkLogEvent { id: string; timestamp: string; provider: string; message: string; type: LogType }
interface GatewayRow { id: string; display_name?: string | null; provider?: string | null; environment?: string | null; status?: string | null }

const normalizeProvider = (value: string | null | undefined) => value?.trim() || 'Gateway';
const normalizeStatus = (value: string | null | undefined): GatewayStatus => {
  const normalized = value?.trim().toLowerCase();
  return ['active', 'connected', 'degraded'].includes(normalized || '') ? 'OPERACIONAL' : 'INDISPONÍVEL';
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
  const [webhookSecrets, setWebhookSecrets] = useState<Record<string, string>>({});
  const [savingWebhookSecret, setSavingWebhookSecret] = useState<string | null>(null);
  const [webhookSecretMessage, setWebhookSecretMessage] = useState('');
  const [webhookSecretError, setWebhookSecretError] = useState('');

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
        rawStatus: row.status?.trim().toLowerCase() || 'unknown',
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
          if (payload.eventType === 'DELETE') {
            setGateways(current => current.filter(item => item.id !== row.id));
            appendLog({
              id: `gateway-${row.id}-deleted-${Date.now()}`,
              timestamp: formatTime(new Date()),
              provider: normalizeProvider(row.display_name ?? row.provider),
              message: 'REGISTRO REMOVIDO',
              type: 'CRITICAL',
            });
            return;
          }
          const next: GatewayState = {
            id: row.id,
            name: normalizeProvider(row.display_name),
            provider: normalizeProvider(row.provider),
            environment: row.environment?.trim() || 'production',
            status: normalizeStatus(row.status),
            rawStatus: row.status?.trim().toLowerCase() || 'unknown',
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
  const sigilopayGateways = gateways.filter(gateway =>
    gateway.name.toLowerCase().includes('sigilo') || gateway.provider.toLowerCase().includes('sigilo')
  );

  const saveWebhookSecret = async (gatewayId: string) => {
    const value = webhookSecrets[gatewayId] ?? '';
    if (value.trim().length < 16) {
      setWebhookSecretError('O token precisa ter pelo menos 16 caracteres.');
      setWebhookSecretMessage('');
      return;
    }
    setSavingWebhookSecret(gatewayId);
    setWebhookSecretError('');
    setWebhookSecretMessage('');
    try {
      const { error } = await supabase.rpc('upsert_gateway_webhook_secret', {
        p_gateway_id: gatewayId,
        p_secret: value.trim(),
      });
      if (error) throw error;
      setWebhookSecrets(current => ({ ...current, [gatewayId]: '' }));
      setWebhookSecretMessage('Token do webhook salvo com segurança no Vault para este gateway.');
    } catch (cause) {
      setWebhookSecretError(cause instanceof Error ? cause.message : 'Não foi possível salvar o token do webhook.');
    } finally {
      setSavingWebhookSecret(null);
    }
  };

  return (
    <main className="mx-auto w-full max-w-[1400px] space-y-7 px-0 py-2 pb-24 sm:px-2 sm:py-4 lg:px-0">
      <DynamicGatewayConnector />

      <GlobalFunnelGatewaySwitch gateways={gateways.map((gateway) => ({ id: gateway.id, name: gateway.name, provider: gateway.provider, rawStatus: gateway.rawStatus }))} />

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

      {sigilopayGateways.length > 0 && (
        <section className="space-y-3 rounded-xl border border-emerald-400/20 bg-[#0a0f0d] p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Autenticação do webhook SigiloPay</h2>
          </div>
          <p className="text-xs leading-5 text-zinc-400">Cadastre o mesmo token configurado no painel SigiloPay. O segredo é armazenado no Vault e vinculado individualmente ao gateway; ele não será exibido novamente.</p>
          <div className="space-y-4">
            {sigilopayGateways.map(gateway => (
              <div key={gateway.id} className="space-y-2 rounded-lg border border-white/[0.08] bg-black/20 p-3">
                <div className="text-xs font-semibold text-zinc-200">{gateway.name}</div>
                <label className="block text-[10px] uppercase tracking-wide text-zinc-500" htmlFor={'sigilopay-secret-' + gateway.id}>Token secreto do webhook</label>
                <input
                  id={'sigilopay-secret-' + gateway.id}
                  type="password"
                  autoComplete="new-password"
                  value={webhookSecrets[gateway.id] ?? ''}
                  onChange={event => setWebhookSecrets(current => ({ ...current, [gateway.id]: event.target.value }))}
                  placeholder="Cole o token fornecido pela SigiloPay"
                  minLength={16}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-3 text-sm text-zinc-100 outline-none transition focus:border-emerald-400/50"
                />
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-[10px] text-zinc-500">Mínimo de 16 caracteres. Não use o token global da Edge Function.</span>
                  <button type="button" onClick={() => void saveWebhookSecret(gateway.id)} disabled={savingWebhookSecret === gateway.id || (webhookSecrets[gateway.id] ?? '').trim().length < 16} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-400 px-4 py-2.5 text-xs font-bold text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40">
                    {savingWebhookSecret === gateway.id ? 'Salvando...' : 'Salvar token'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {webhookSecretMessage && <p role="status" className="flex items-center gap-2 text-xs text-emerald-300"><CheckCircle2 className="h-4 w-4" />{webhookSecretMessage}</p>}
          {webhookSecretError && <p role="alert" className="text-xs text-rose-300">{webhookSecretError}</p>}
        </section>
      )}

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
