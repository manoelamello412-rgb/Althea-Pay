export type JsonRecord = Record<string, unknown>;

export type GatewayTransactionStatus =
  | "created"
  | "pending"
  | "approved"
  | "failed"
  | "refunded"
  | "chargeback";

export type GatewayEventKind = "payment" | "refund" | "chargeback";

const CANONICAL_STATUS_ALIASES: Record<string, GatewayTransactionStatus> = {
  approved: "approved",
  paid: "approved",
  succeeded: "approved",
  success: "approved",
  completed: "approved",
  captured: "approved",
  authorized: "approved",
  pending: "pending",
  processing: "pending",
  waiting: "pending",
  failed: "failed",
  failure: "failed",
  declined: "failed",
  canceled: "failed",
  cancelled: "failed",
  refunded: "refunded",
  refund: "refunded",
  chargeback: "chargeback",
  disputed: "chargeback",
  created: "created",
};

const STATUS_KEYS = [
  "status",
  "payment_status",
  "paymentStatus",
  "transaction_status",
  "transactionStatus",
  "state",
];

const EXTERNAL_TRANSACTION_ID_KEYS = [
  "external_transaction_id",
  "external_id",
  "transaction_id",
  "transactionId",
  "payment_id",
  "paymentId",
];

const AMOUNT_KEYS = ["amount", "value", "total_amount", "totalAmount"];
const CURRENCY_KEYS = ["currency", "currency_code", "currencyCode"];
const FAILURE_CODE_KEYS = ["failure_code", "failureCode", "error_code", "errorCode"];
const EVENT_KIND_KEYS = ["event_kind", "eventKind", "event_type", "eventType"];

export const isGatewayWebhookRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const usable = (value: unknown): boolean =>
  value !== undefined && value !== null && String(value).trim() !== "";

export const firstUsableGatewayWebhookValue = (
  record: JsonRecord,
  keys: string[],
): unknown => {
  for (const key of keys) {
    const value = record[key];
    if (usable(value)) return value;
  }
  return undefined;
};

export const firstGatewayWebhookValue = (
  payload: JsonRecord,
  keys: string[],
): unknown => {
  const topLevel = firstUsableGatewayWebhookValue(payload, keys);
  if (topLevel !== undefined) return topLevel;

  const data = isGatewayWebhookRecord(payload.data) ? payload.data : null;
  return data ? firstUsableGatewayWebhookValue(data, keys) : undefined;
};

export const normalizeGatewayWebhookStatus = (
  value: unknown,
): GatewayTransactionStatus | null => {
  const raw = String(value ?? "").trim().toLowerCase();
  return CANONICAL_STATUS_ALIASES[raw] ?? null;
};

export type GatewayWebhookExtractionOptions = {
  normalizeStatus?: (value: unknown) => GatewayTransactionStatus | null;
  fallbackStatus?: unknown;
  fallbackExternalTransactionId?: unknown;
  fallbackEventKind?: unknown;
  extraExternalTransactionIdKeys?: string[];
};

export type GatewayWebhookFinancialFields = {
  rawStatus: string;
  status: GatewayTransactionStatus | null;
  externalTransactionId: string;
  amount: number | null;
  currency: string | null;
  failureCode: string | null;
  eventKind: GatewayEventKind;
};

export const extractGatewayWebhookFinancialFields = (
  payload: JsonRecord,
  options: GatewayWebhookExtractionOptions = {},
): GatewayWebhookFinancialFields => {
  const normalizeStatus = options.normalizeStatus ?? normalizeGatewayWebhookStatus;
  const rawStatusValue =
    firstGatewayWebhookValue(payload, STATUS_KEYS) ?? options.fallbackStatus;
  const rawStatus = String(rawStatusValue ?? "").trim().toLowerCase();
  const status = normalizeStatus(rawStatusValue);

  const externalTransactionIdValue =
    firstGatewayWebhookValue(payload, [
      ...EXTERNAL_TRANSACTION_ID_KEYS,
      ...(options.extraExternalTransactionIdKeys ?? []),
    ]) ?? options.fallbackExternalTransactionId;
  const externalTransactionId = String(externalTransactionIdValue ?? "").trim();

  const amountValue = firstGatewayWebhookValue(payload, AMOUNT_KEYS);
  const amountNumber = amountValue === undefined ? Number.NaN : Number(amountValue);
  const amount = Number.isFinite(amountNumber) ? amountNumber : null;

  const currencyValue = firstGatewayWebhookValue(payload, CURRENCY_KEYS);
  const currency =
    currencyValue === undefined ? null : String(currencyValue).trim() || null;

  const failureCodeValue = firstGatewayWebhookValue(payload, FAILURE_CODE_KEYS);
  const failureCode =
    failureCodeValue === undefined
      ? null
      : String(failureCodeValue).trim() || null;

  const eventKindValue =
    firstGatewayWebhookValue(payload, EVENT_KIND_KEYS) ?? options.fallbackEventKind;
  const explicitEventKind = String(eventKindValue ?? "").trim().toLowerCase();

  let eventKind: GatewayEventKind = "payment";
  if (explicitEventKind.includes("chargeback") || explicitEventKind.includes("dispute")) {
    eventKind = "chargeback";
  } else if (explicitEventKind.includes("refund") || status === "refunded") {
    eventKind = "refund";
  } else if (status === "chargeback") {
    eventKind = "chargeback";
  }

  return {
    rawStatus,
    status,
    externalTransactionId,
    amount,
    currency,
    failureCode,
    eventKind,
  };
};
