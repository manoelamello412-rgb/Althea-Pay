import type { SupabaseClient } from '@supabase/supabase-js'

export enum StreamTopic {
  WEBHOOK_LOG = 'WEBHOOK_LOG',
  AI_CHAT_MESSAGE = 'AI_CHAT_MESSAGE',
  METRICS_UPDATE = 'METRICS_UPDATE',
}

export interface SocketMessageEnvelope<TPayload = unknown> {
  topic: StreamTopic
  tenantId: string
  productId?: string
  eventId: string
  sequenceId?: number
  payload: TPayload
  timestamp: string
}

export interface StreamBrokerOptions {
  supabase: SupabaseClient
  channelPrefix?: string
  backlogSeconds?: number
}

interface BufferedEnvelope {
  envelope: SocketMessageEnvelope
  expiresAt: number
}

const DEFAULT_BACKLOG_SECONDS = 30
const MAX_BACKLOG_EVENTS = 500

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function createEventId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Realtime broker backed by Supabase Realtime Broadcast.
 *
 * Important: Vercel/Next.js is not treated as a durable WebSocket server.
 * PostgreSQL remains the source of truth; Realtime is the transport layer.
 * Authorization is performed before a tenant channel is created.
 */
export class AltheaWebsocketStreamBroker {
  private readonly supabase: SupabaseClient
  private readonly channelPrefix: string
  private readonly backlogMs: number
  private readonly buffers = new Map<string, BufferedEnvelope[]>()

  public constructor(options: StreamBrokerOptions) {
    this.supabase = options.supabase
    this.channelPrefix = options.channelPrefix ?? 'althea:iara'
    this.backlogMs = Math.max(1, options.backlogSeconds ?? DEFAULT_BACKLOG_SECONDS) * 1000
  }

  public tenantChannel(tenantId: string): string {
    if (!isUuid(tenantId)) throw new Error('Tenant inválido.')
    return `${this.channelPrefix}:tenant:${tenantId}`
  }

  /**
   * Publishes only to the explicitly authorized tenant channel.
   * Callers must pass a tenant already derived from authenticated authorization,
   * never from an untrusted client payload.
   */
  public async broadcastToTenant<TPayload>(
    tenantId: string,
    topic: StreamTopic,
    payload: TPayload,
    options?: { productId?: string; sequenceId?: number; eventId?: string },
  ): Promise<void> {
    const channelName = this.tenantChannel(tenantId)
    const envelope: SocketMessageEnvelope<TPayload> = {
      topic,
      tenantId,
      productId: options?.productId,
      eventId: options?.eventId ?? createEventId(),
      sequenceId: options?.sequenceId,
      payload,
      timestamp: new Date().toISOString(),
    }

    this.buffer(tenantId, envelope)

    const channel = this.supabase.channel(channelName)
    try {
      const status = await channel.subscribe()
      if (status !== 'SUBSCRIBED') {
        throw new Error(`Realtime não confirmou inscrição: ${status}`)
      }

      const result = await channel.send({
        type: 'broadcast',
        event: topic,
        payload: envelope,
      })

      if (result !== 'ok') {
        throw new Error(`Falha no broadcast Realtime: ${result}`)
      }
    } finally {
      await this.supabase.removeChannel(channel)
    }
  }

  /**
   * Returns events retained for a reconnecting tenant. The caller must still
   * authenticate and authorize the tenant before exposing this data to a client.
   */
  public getBacklog<TPayload = unknown>(tenantId: string): SocketMessageEnvelope<TPayload>[] {
    this.tenantChannel(tenantId)
    this.prune(tenantId)
    return (this.buffers.get(tenantId) ?? []).map((item) => item.envelope as SocketMessageEnvelope<TPayload>)
  }

  public acknowledgeBacklog(tenantId: string, eventIds: readonly string[]): void {
    this.tenantChannel(tenantId)
    if (eventIds.length === 0) return

    const ids = new Set(eventIds)
    const next = (this.buffers.get(tenantId) ?? []).filter((item) => !ids.has(item.envelope.eventId))
    if (next.length === 0) this.buffers.delete(tenantId)
    else this.buffers.set(tenantId, next)
  }

  public clearTenantBacklog(tenantId: string): void {
    this.tenantChannel(tenantId)
    this.buffers.delete(tenantId)
  }

  private buffer(tenantId: string, envelope: SocketMessageEnvelope): void {
    this.prune(tenantId)
    const current = this.buffers.get(tenantId) ?? []
    current.push({ envelope, expiresAt: Date.now() + this.backlogMs })
    if (current.length > MAX_BACKLOG_EVENTS) current.splice(0, current.length - MAX_BACKLOG_EVENTS)
    this.buffers.set(tenantId, current)
  }

  private prune(tenantId: string): void {
    const current = this.buffers.get(tenantId)
    if (!current) return
    const now = Date.now()
    const next = current.filter((item) => item.expiresAt > now)
    if (next.length === 0) this.buffers.delete(tenantId)
    else if (next.length !== current.length) this.buffers.set(tenantId, next)
  }
}
