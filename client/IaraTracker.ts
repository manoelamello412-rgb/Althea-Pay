export interface BehaviorMetrics {
  timeOnCheckoutSeconds: number;
  tabSwitchesCount: number;
  typingHesitationScore: number;
  mouseLeaveDetected: boolean;
}

export interface TelemetryPackage {
  schemaVersion: 1;
  eventId: string;
  occurredAt: string;
  tenantId: string;
  productId: string;
  clientId: string;
  behaviorMetrics: BehaviorMetrics;
  gatewayLatencyMs: number | null;
}

export type PredictiveIntervention = {
  eventId: string;
  clientId: string;
  action: 'LIVE_CHAT_RESCUE' | 'WAIT_AND_OBSERVE' | 'GENERATE_PIX_DISCOUNT';
  offerText: string;
};

export interface IaraTrackerOptions {
  telemetryEndpoint: string;
  tenantId?: string;
  productId?: string;
  clientId?: string;
  intervalMs?: number;
  maxReconnectDelayMs?: number;
  enabled?: boolean;
  onIntervention?: (intervention: PredictiveIntervention) => void;
}

type TrackerConfig = {
  tenantId: string;
  productId: string;
};

const STORAGE_KEY = 'althea_iara_client_id';
const DEFAULT_INTERVAL_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const MAX_HESITATION = 100;
const MAX_BATCH = 8;

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function isSensitivePaymentField(element: HTMLElement): boolean {
  if (!(element instanceof HTMLInputElement)) return false;

  const tokens = [
    element.name,
    element.id,
    element.autocomplete,
    element.getAttribute('data-field') ?? '',
  ]
    .join(' ')
    .toLowerCase();

  return /card|cc-|cvv|cvc|security.?code|iban|account.?number/.test(tokens);
}

function readConfig(options: IaraTrackerOptions): TrackerConfig | null {
  const root = document.querySelector<HTMLElement>('[data-althea-tenant][data-althea-product]');
  const tenantId = options.tenantId ?? root?.dataset.altheaTenant;
  const productId = options.productId ?? root?.dataset.altheaProduct;

  if (!tenantId || !productId) return null;
  if (tenantId.length > 128 || productId.length > 128) return null;

  return { tenantId, productId };
}

function readClientId(explicit?: string): string {
  if (explicit) return explicit;

  try {
    const existing = sessionStorage.getItem(STORAGE_KEY);
    if (existing && existing.length <= 128) return existing;
    const generated = createId();
    sessionStorage.setItem(STORAGE_KEY, generated);
    return generated;
  } catch {
    return createId();
  }
}

/**
 * Privacy-first behavioral telemetry for Althea checkout funnels.
 *
 * The tracker never reads, stores, hashes, or transmits field values.
 * It records only aggregate timing/interaction signals. The browser is
 * intentionally not trusted for tenant authorization; the ingestion API
 * must validate the tenant/product context server-side.
 */
export class IaraTracker {
  private readonly endpoint: string;
  private readonly tenantId: string;
  private readonly productId: string;
  private readonly clientId: string;
  private readonly intervalMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly onIntervention?: (intervention: PredictiveIntervention) => void;

  private readonly startedAt = performance.now();
  private readonly pending: TelemetryPackage[] = [];
  private readonly abortController = new AbortController();

  private intervalHandle: number | null = null;
  private reconnectHandle: number | null = null;
  private reconnectDelayMs = 1_000;
  private tabSwitches = 0;
  private hesitationScore = 0;
  private lastKeyAt: number | null = null;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private lastMouseAt: number | null = null;
  private mouseLeaveFired = false;
  private destroyed = false;

  public constructor(options: IaraTrackerOptions) {
    const config = readConfig(options);
    if (!config) {
      throw new Error('IARA tracker requires a valid Althea tenant and product context.');
    }

    if (!options.telemetryEndpoint.startsWith('/')) {
      const parsed = new URL(options.telemetryEndpoint, window.location.origin);
      if (parsed.protocol !== 'https:' && parsed.origin !== window.location.origin) {
        throw new Error('IARA telemetry endpoint must use HTTPS or same-origin transport.');
      }
    }

    this.endpoint = options.telemetryEndpoint;
    this.tenantId = config.tenantId;
    this.productId = config.productId;
    this.clientId = readClientId(options.clientId);
    this.intervalMs = Math.max(2_000, options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.maxReconnectDelayMs = Math.max(this.intervalMs, options.maxReconnectDelayMs ?? MAX_RECONNECT_DELAY_MS);
    this.onIntervention = options.onIntervention;

    if (options.enabled === false) return;
    this.bindSensors();
    this.startHeartbeat();
    this.flush();
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abortController.abort();

    if (this.intervalHandle !== null) window.clearInterval(this.intervalHandle);
    if (this.reconnectHandle !== null) window.clearTimeout(this.reconnectHandle);

    this.intervalHandle = null;
    this.reconnectHandle = null;
    this.flush(true);
  }

  private bindSensors(): void {
    document.addEventListener('visibilitychange', this.handleVisibility, { signal: this.abortController.signal });
    document.addEventListener('keydown', this.handleKeyDown, { signal: this.abortController.signal, passive: true });
    document.addEventListener('mousemove', this.handleMouseMove, { signal: this.abortController.signal, passive: true });
    document.addEventListener('mouseleave', this.handleMouseLeave, { signal: this.abortController.signal, passive: true });
    window.addEventListener('pageshow', this.handlePageShow, { signal: this.abortController.signal });
    window.addEventListener('pagehide', this.handlePageHide, { signal: this.abortController.signal });
  }

  private readonly handleVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      this.tabSwitches = Math.min(this.tabSwitches + 1, 100);
      this.enqueue(false);
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.tagName !== 'INPUT' && target.tagName !== 'SELECT') return;
    if (isSensitivePaymentField(target)) return;

    const now = performance.now();
    if (this.lastKeyAt !== null) {
      const interval = now - this.lastKeyAt;
      if (interval >= 1_500) {
        this.hesitationScore = bounded(this.hesitationScore + Math.min(20, interval / 250), 0, MAX_HESITATION);
      } else if (interval < 600) {
        this.hesitationScore = bounded(this.hesitationScore - 5, 0, MAX_HESITATION);
      }
    }
    this.lastKeyAt = now;
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    this.lastMouseX = event.clientX;
    this.lastMouseY = event.clientY;
    this.lastMouseAt = performance.now();
  };

  private readonly handleMouseLeave = (event: MouseEvent): void => {
    if (this.mouseLeaveFired || event.clientY > 24) return;

    const now = performance.now();
    const elapsed = this.lastMouseAt === null ? 1 : Math.max(1, now - this.lastMouseAt);
    const speed = Math.hypot(event.clientX - this.lastMouseX, event.clientY - this.lastMouseY) / elapsed;

    // This is only an intent signal. It is never treated as proof of abandonment.
    if (speed >= 0.35 || event.clientY <= 4) {
      this.mouseLeaveFired = true;
      this.enqueue(true);
    }
  };

  private readonly handlePageShow = (): void => {
    this.mouseLeaveFired = false;
    this.startHeartbeat();
  };

  private readonly handlePageHide = (): void => {
    this.enqueue(false);
    this.flush(true);
  };

  private startHeartbeat(): void {
    if (this.intervalHandle !== null || this.destroyed) return;
    this.intervalHandle = window.setInterval(() => this.enqueue(false), this.intervalMs);
  }

  private enqueue(mouseLeaveDetected: boolean): void {
    if (this.destroyed) return;

    const packageEvent: TelemetryPackage = {
      schemaVersion: 1,
      eventId: createId(),
      occurredAt: new Date().toISOString(),
      tenantId: this.tenantId,
      productId: this.productId,
      clientId: this.clientId,
      behaviorMetrics: {
        timeOnCheckoutSeconds: Math.max(0, Math.floor((performance.now() - this.startedAt) / 1_000)),
        tabSwitchesCount: this.tabSwitches,
        typingHesitationScore: Math.round(bounded(this.hesitationScore, 0, MAX_HESITATION)),
        mouseLeaveDetected: mouseLeaveDetected || this.mouseLeaveFired,
      },
      gatewayLatencyMs: null,
    };

    if (this.pending.length >= MAX_BATCH) this.pending.shift();
    this.pending.push(packageEvent);

    if (mouseLeaveDetected) this.flush(true);
    else if (this.pending.length >= 4) this.flush();
  }

  private flush(unload = false): void {
    if (this.pending.length === 0 || this.destroyed && !unload) return;

    const batch = this.pending.splice(0, MAX_BATCH);
    const body = JSON.stringify({
      schemaVersion: 1,
      tenantId: this.tenantId,
      productId: this.productId,
      clientId: this.clientId,
      events: batch,
    });

    if (unload && typeof navigator.sendBeacon === 'function') {
      const accepted = navigator.sendBeacon(this.endpoint, new Blob([body], { type: 'application/json' }));
      if (accepted) return;
    }

    void fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      credentials: 'same-origin',
      keepalive: unload,
      signal: unload ? undefined : this.abortController.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(`telemetry_http_${response.status}`);
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) return;
      const payload: unknown = await response.json();
      this.handleServerResponse(payload);
      this.reconnectDelayMs = 1_000;
    }).catch(() => {
      // Never block checkout. Retry with bounded exponential backoff.
      this.pending.unshift(...batch.slice(-MAX_BATCH));
      this.scheduleRetry();
    });
  }

  private scheduleRetry(): void {
    if (this.destroyed || this.reconnectHandle !== null) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.maxReconnectDelayMs);
    this.reconnectHandle = window.setTimeout(() => {
      this.reconnectHandle = null;
      this.flush();
    }, delay);
  }

  private handleServerResponse(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const candidate = payload as Record<string, unknown>;
    if (candidate.type !== 'IARA_PREDICTIVE_INTERVENTION') return;

    const intervention = candidate.intervention;
    if (!intervention || typeof intervention !== 'object') return;

    const value = intervention as Record<string, unknown>;
    if (value.clientId !== this.clientId) return;
    if (typeof value.eventId !== 'string' || typeof value.offerText !== 'string') return;
    if (value.action !== 'LIVE_CHAT_RESCUE' && value.action !== 'WAIT_AND_OBSERVE' && value.action !== 'GENERATE_PIX_DISCOUNT') return;

    this.onIntervention?.({
      eventId: value.eventId,
      clientId: value.clientId,
      action: value.action,
      offerText: value.offerText,
    });
  }
}
