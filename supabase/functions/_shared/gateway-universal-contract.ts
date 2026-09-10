// ALTHEA PAY — Universal Gateway Adapter Contract
// Provider-neutral by design. The Core depends only on this contract.

export type GatewayFailureClass =
  | "technical"
  | "timeout"
  | "unavailable"
  | "declined"
  | "fraud"
  | "pending"
  | "validation"
  | "unknown";

export type GatewayPaymentStatus =
  | "approved"
  | "pending"
  | "declined"
  | "failed"
  | "refunded"
  | "chargeback";

export interface GatewayCapabilities {
  readonly authorize: boolean;
  readonly capture: boolean;
  readonly void: boolean;
  readonly refund: boolean;
  readonly retrieveStatus: boolean;
  readonly tokenize: boolean;
  readonly webhooks: boolean;
}

export interface UniversalPaymentRequest {
  readonly amountMinor: number;
  readonly currency: string;
  readonly idempotencyKey: string;
  readonly paymentMethod: "CREDIT_CARD" | "PIX" | "BOLETO" | string;
  readonly cardBrand?: string;
  readonly paymentToken?: string;
  readonly customer: Readonly<{
    name?: string;
    email?: string;
    ip?: string;
  }>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface UniversalGatewayResponse {
  readonly success: boolean;
  readonly providerTransactionId?: string;
  readonly status: GatewayPaymentStatus;
  readonly amountMinor?: number;
  readonly currency?: string;
  readonly failureClass?: GatewayFailureClass;
  readonly failureCode?: string;
  /** Provider payload must be redacted before it reaches the Core trace/log layer. */
  readonly rawPayload?: unknown;
}

export interface UniversalWebhookEvent {
  readonly providerEventId: string;
  readonly providerTransactionId?: string;
  readonly status?: GatewayPaymentStatus;
  readonly idempotencyKey: string;
  readonly occurredAt?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface UniversalGatewayAdapter {
  readonly contractVersion: 1;
  readonly capabilities: GatewayCapabilities;

  createOrAuthorize(
    request: UniversalPaymentRequest,
    credential: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<UniversalGatewayResponse>;

  capture?(
    providerTransactionId: string,
    amountMinor: number,
    credential: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<UniversalGatewayResponse>;

  cancelOrVoid?(
    providerTransactionId: string,
    credential: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<UniversalGatewayResponse>;

  refund?(
    providerTransactionId: string,
    amountMinor: number,
    credential: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<UniversalGatewayResponse>;

  retrieveStatus?(
    providerTransactionId: string,
    credential: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<UniversalGatewayResponse>;

  verifyWebhookSignature(
    rawBody: string,
    headers: Readonly<Record<string, string>>,
    webhookSecret: string,
  ): Promise<boolean>;

  normalizeWebhookEvent(
    rawBody: string,
    headers?: Readonly<Record<string, string>>,
  ): Promise<UniversalWebhookEvent>;

  healthCheck?(
    credential: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; latencyMs: number }>;
}

export function hasGatewayCapability(
  adapter: UniversalGatewayAdapter,
  capability: keyof GatewayCapabilities,
): boolean {
  return adapter.capabilities[capability] === true;
}

/**
 * Credential values are deliberately opaque to the Core. PAN/CVV are not
 * accepted by this contract; tokenization must occur inside a PCI-scoped
 * component and only a provider token may cross the orchestration boundary.
 */
export function assertSafeCredentialKeys(
  credential: Readonly<Record<string, string>>,
): void {
  const forbidden = new Set(["pan", "card_number", "cvv", "cvc", "security_code"]);
  for (const key of Object.keys(credential)) {
    if (forbidden.has(key.toLowerCase())) {
      throw new Error("gateway_credential_contains_cardholder_data");
    }
  }
}
