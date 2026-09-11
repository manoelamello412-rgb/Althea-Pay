import {
  assertSafeCredentialKeys,
  hasGatewayCapability,
} from "../supabase/functions/_shared/gateway-universal-contract";

export type {
  GatewayFailureClass,
  GatewayPaymentStatus,
  GatewayCapabilities,
  UniversalPaymentRequest,
  UniversalGatewayResponse,
  UniversalWebhookEvent,
  UniversalGatewayAdapter,
} from "../supabase/functions/_shared/gateway-universal-contract";

/**
 * Canonical Gateway contract facade.
 * The provider-neutral contract in supabase/functions/_shared is the single
 * source of truth; this module exists only as a stable import boundary for
 * application code and the release preflight.
 */
export type GatewayAdapter = import("../supabase/functions/_shared/gateway-universal-contract").UniversalGatewayAdapter;

export type GatewayOperation =
  | "authorize"
  | "capture"
  | "refund"
  | "void";

export type GatewayResponseStatus =
  | "approved"
  | "declined"
  | "error"
  | "pending";

export type GatewayResponse = import("../supabase/functions/_shared/gateway-universal-contract").UniversalGatewayResponse;

export { assertSafeCredentialKeys, hasGatewayCapability };

const RETRYABLE_FAILURES: ReadonlySet<import("../supabase/functions/_shared/gateway-universal-contract").GatewayFailureClass> = new Set([
  "technical",
  "timeout",
  "unavailable",
]);

export function isRetryableGatewayFailure(
  failureClass?: import("../supabase/functions/_shared/gateway-universal-contract").GatewayFailureClass,
): boolean {
  return failureClass !== undefined && RETRYABLE_FAILURES.has(failureClass);
}

export function normalizeGatewayResponse(
  response: GatewayResponse,
): GatewayResponse {
  if (!response.providerTransactionId || !response.providerTransactionId.trim()) {
    throw new Error("gateway_response_missing_provider_transaction_id");
  }
  if (
    response.amountMinor !== undefined &&
    (!Number.isFinite(response.amountMinor) || response.amountMinor < 0)
  ) {
    throw new Error("gateway_response_invalid_amount");
  }
  if (response.currency !== undefined && !/^[A-Z]{3}$/.test(response.currency)) {
    throw new Error("gateway_response_invalid_currency");
  }
  if (response.status === "declined" && response.failureClass === undefined) {
    return { ...response, failureClass: "declined" };
  }
  if (response.status === "pending" && response.failureClass === undefined) {
    return { ...response, failureClass: "pending" };
  }
  return response;
}
