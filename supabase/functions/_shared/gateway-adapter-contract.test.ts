import type { UniversalGatewayAdapter, UniversalPaymentRequest } from "./gateway-universal-contract.ts";
import { assertSafeCredentialKeys, hasGatewayCapability } from "./gateway-universal-contract.ts";

/** Provider-neutral contract tests. They do not insert rows into production tables. */
export async function runGatewayAdapterContract(
  adapter: UniversalGatewayAdapter,
  credential: Readonly<Record<string, string>>,
): Promise<string[]> {
  const logs: string[] = [];
  if (adapter.contractVersion !== 1) throw new Error("adapter_contract_version_unsupported");
  if (!adapter.capabilities || typeof adapter.capabilities !== "object") throw new Error("adapter_capabilities_missing");
  if (!hasGatewayCapability(adapter, "authorize")) throw new Error("adapter_authorize_capability_missing");
  assertSafeCredentialKeys(credential);
  logs.push("capabilities:ok");

  const request: UniversalPaymentRequest = {
    amountMinor: 100,
    currency: "BRL",
    idempotencyKey: `contract:${crypto.randomUUID()}`,
    paymentMethod: "CREDIT_CARD",
    cardBrand: "visa",
    customer: { name: "Contract Test", email: "contract-test@example.invalid" },
  };

  const result = await adapter.createOrAuthorize(request, credential);
  if (!result.status) throw new Error("adapter_status_missing");
  if (result.success && !result.providerTransactionId) throw new Error("approved_response_requires_provider_transaction_id");
  logs.push("create_or_authorize:ok");

  if (adapter.capabilities.retrieveStatus && result.providerTransactionId && adapter.retrieveStatus) {
    const status = await adapter.retrieveStatus(result.providerTransactionId, credential);
    if (!status.status) throw new Error("retrieve_status_missing_normalized_status");
    logs.push("retrieve_status:ok");
  }

  const normalized = await adapter.normalizeWebhookEvent(
    JSON.stringify({ contract: true, providerTransactionId: result.providerTransactionId ?? "contract-id" }),
    {},
  );
  if (!normalized.providerEventId || !normalized.idempotencyKey) throw new Error("webhook_normalization_contract_failed");
  logs.push("webhook_normalization:ok");

  return logs;
}
