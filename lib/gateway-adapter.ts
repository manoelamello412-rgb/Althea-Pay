export type GatewayOperation = 'authorize' | 'capture' | 'refund' | 'void'

export type GatewayResponseStatus = 'approved' | 'declined' | 'error' | 'pending'

export type GatewayFailureClass =
  | 'technical'
  | 'timeout'
  | 'unavailable'
  | 'declined'
  | 'fraud'
  | 'pending'
  | 'validation'
  | 'unknown'

export type GatewayResponse = {
  id: string;
  status: GatewayResponseStatus;
  amount: number;
  currency: string;
  failureClass?: GatewayFailureClass;
  failureCode?: string;
  raw?: unknown;
};

export type GatewayAuthParams = {
  amount: number;
  currency: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
};

export type GatewayCapabilities = Readonly<{
  authorize: boolean;
  capture: boolean;
  refund: boolean;
  void: boolean;
  webhooks: boolean;
}>;

const RETRYABLE_FAILURES: ReadonlySet<GatewayFailureClass> = new Set([
  'technical',
  'timeout',
  'unavailable',
]);

export function isRetryableGatewayFailure(failureClass?: GatewayFailureClass): boolean {
  return failureClass !== undefined && RETRYABLE_FAILURES.has(failureClass);
}

export function normalizeGatewayResponse(response: GatewayResponse): GatewayResponse {
  if (!response.id || !response.id.trim()) {
    throw new Error('gateway_response_missing_id');
  }
  if (!Number.isFinite(response.amount) || response.amount < 0) {
    throw new Error('gateway_response_invalid_amount');
  }
  if (!/^[A-Z]{3}$/.test(response.currency)) {
    throw new Error('gateway_response_invalid_currency');
  }
  if (response.status === 'declined' && response.failureClass === undefined) {
    return { ...response, failureClass: 'declined' };
  }
  if (response.status === 'pending' && response.failureClass === undefined) {
    return { ...response, failureClass: 'pending' };
  }
  return response;
}

export interface GatewayAdapter {
  readonly capabilities?: GatewayCapabilities;

  authorize(params: GatewayAuthParams): Promise<GatewayResponse>;
  capture(authorizationId: string, amount?: number): Promise<GatewayResponse>;
  refund(transactionId: string, amount?: number): Promise<GatewayResponse>;
  void(authorizationId: string): Promise<GatewayResponse>;
  healthCheck(): Promise<{ ok: boolean; details?: unknown }>;
  handleWebhook(rawBody: unknown, headers: Record<string, string>): Promise<{ ok: boolean; event?: unknown }>;
}
