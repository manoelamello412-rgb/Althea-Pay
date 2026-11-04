export type SigiloPayAddress = {
  country: string;
  zipCode: string;
  state: string;
  city: string;
  neighborhood: string;
  street: string;
  number: string;
  complement?: string;
};

export type SigiloPayPixInformation = {
  id: string;
  qrCode: string;
  endToEndId: string;
};

export type SigiloPayPixMetadata = {
  payerName?: string;
  payerDocument?: string;
  payerBankName?: string;
  payerBankAccount?: string;
  payerBankBranch?: string;
  receiverName?: string;
  receiverDocument?: string;
  receiverBankName?: string;
  receiverBankAccount?: string;
  receiverBankBranch?: string;
};

export type SigiloPayBoletoInformation = {
  transactionId: string;
  id: string;
  barcode: string;
  digitableLine: string;
  pdfUrl: string;
  instructions: string;
  createdAt: string;
  updatedAt: string;
};

export type SigiloPaySubscription = {
  id: string;
  identifier: string;
  cycle: number;
  startAt: string;
  intervalType: "DAYS" | "WEEKS" | "MONTHS" | "YEARS";
  intervalCount: number;
  status: "ACTIVE" | "INACTIVE" | "CANCELED";
};

export type SigiloPayOrderItem = {
  id: string;
  price: number;
  product: {
    id: string;
    name: string;
    externalId: string;
  };
};

export type SigiloPayTrackProps = {
  utm_id?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  fbc?: string;
  fbp?: string;
  ip?: string;
  country?: string;
  user_agent?: string;
  zip_code?: string;
  city?: string;
  state?: string;
};

export type SigiloPayTransactionCreatedPayload = {
  event: "TRANSACTION_CREATED";
  token: string;
  offerCode: string;
  checkoutUrl: string;
  client: {
    id: string;
    name: string;
    email: string;
    phone: string;
    cpf: string;
    cnpj: string | null;
    address: SigiloPayAddress | null;
  };
  transaction: {
    id: string;
    identifier: string;
    status: "COMPLETED" | "FAILED" | "PENDING" | "REFUNDED" | "CHARGED_BACK";
    paymentMethod: "CREDIT_CARD" | "PIX" | "BOLETO" | "CRYPTO";
    originalAmount: number;
    amount: number;
    commissionAmount?: number;
    originalCurrency: string;
    currency: string;
    exchangeRate: number;
    installments: number;
    createdAt: string;
    payedAt: string | null;
    pixInformation?: SigiloPayPixInformation | null;
    pixMetadata?: SigiloPayPixMetadata;
    boletoInformation?: SigiloPayBoletoInformation | null;
  };
  subscription: SigiloPaySubscription | null;
  orderItems: SigiloPayOrderItem[];
  trackProps: SigiloPayTrackProps;
};

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasString = (value: UnknownRecord, key: string): boolean =>
  typeof value[key] === "string";

const hasNumber = (value: UnknownRecord, key: string): boolean =>
  typeof value[key] === "number" && Number.isFinite(Number(value[key]));

const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  Number.isFinite(Date.parse(value));

const hasOptionalStringFields = (value: UnknownRecord, keys: string[]): boolean =>
  keys.every((key) => value[key] === undefined || typeof value[key] === "string");

const validAddress = (value: unknown): value is SigiloPayAddress | null => {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return ["country", "zipCode", "state", "city", "neighborhood", "street", "number"]
    .every((key) => hasString(value, key)) &&
    hasOptionalStringFields(value, ["complement"]);
};

const validPixInformation = (value: unknown): value is SigiloPayPixInformation | null => {
  if (value === null) return true;
  return isRecord(value) && ["id", "qrCode", "endToEndId"].every((key) => hasString(value, key));
};

const validPixMetadata = (value: unknown): value is SigiloPayPixMetadata =>
  isRecord(value) && hasOptionalStringFields(value, [
    "payerName", "payerDocument", "payerBankName", "payerBankAccount",
    "payerBankBranch", "receiverName", "receiverDocument", "receiverBankName",
    "receiverBankAccount", "receiverBankBranch",
  ]);

const validBoletoInformation = (value: unknown): value is SigiloPayBoletoInformation | null => {
  if (value === null) return true;
  return isRecord(value) &&
    ["transactionId", "id", "barcode", "digitableLine", "pdfUrl", "instructions"]
      .every((key) => hasString(value, key)) &&
    isIsoDate(value.createdAt) &&
    isIsoDate(value.updatedAt);
};

const validSubscription = (value: unknown): value is SigiloPaySubscription | null => {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return hasString(value, "id") &&
    hasString(value, "identifier") &&
    hasNumber(value, "cycle") &&
    isIsoDate(value.startAt) &&
    ["DAYS", "WEEKS", "MONTHS", "YEARS"].includes(String(value.intervalType)) &&
    hasNumber(value, "intervalCount") &&
    ["ACTIVE", "INACTIVE", "CANCELED"].includes(String(value.status));
};

const validOrderItems = (value: unknown): value is SigiloPayOrderItem[] =>
  Array.isArray(value) && value.every((item) =>
    isRecord(item) &&
    hasString(item, "id") &&
    hasNumber(item, "price") &&
    isRecord(item.product) &&
    hasString(item.product, "id") &&
    hasString(item.product, "name") &&
    hasString(item.product, "externalId")
  );

const validTrackProps = (value: unknown): value is SigiloPayTrackProps =>
  isRecord(value) && hasOptionalStringFields(value, [
    "utm_id", "utm_source", "utm_medium", "utm_campaign", "utm_content",
    "utm_term", "fbc", "fbp", "ip", "country", "user_agent",
    "zip_code", "city", "state",
  ]);

export const parseSigiloPayTransactionCreatedPayload = (
  value: unknown,
): SigiloPayTransactionCreatedPayload | null => {
  if (!isRecord(value) || value.event !== "TRANSACTION_CREATED" ||
      !hasString(value, "token") || !hasString(value, "offerCode") ||
      !hasString(value, "checkoutUrl") || !isRecord(value.client) ||
      !isRecord(value.transaction) || !validSubscription(value.subscription) ||
      !validOrderItems(value.orderItems) || !validTrackProps(value.trackProps)) {
    return null;
  }

  const client = value.client;
  if (!["id", "name", "email", "phone", "cpf"].every((key) => hasString(client, key)) ||
      !(client.cnpj === null || typeof client.cnpj === "string") ||
      !validAddress(client.address)) return null;

  const tx = value.transaction;
  if (!hasString(tx, "id") || !hasString(tx, "identifier") ||
      !["COMPLETED", "FAILED", "PENDING", "REFUNDED", "CHARGED_BACK"].includes(String(tx.status)) ||
      !["CREDIT_CARD", "PIX", "BOLETO", "CRYPTO"].includes(String(tx.paymentMethod)) ||
      !hasNumber(tx, "originalAmount") || !hasNumber(tx, "amount") ||
      !hasString(tx, "originalCurrency") || !hasString(tx, "currency") ||
      !hasNumber(tx, "exchangeRate") || !hasNumber(tx, "installments") ||
      !isIsoDate(tx.createdAt) ||
      !(tx.payedAt === null || isIsoDate(tx.payedAt)) ||
      (tx.commissionAmount !== undefined &&
        (typeof tx.commissionAmount !== "number" || !Number.isFinite(tx.commissionAmount))) ||
      (tx.pixInformation !== undefined && !validPixInformation(tx.pixInformation)) ||
      (tx.pixMetadata !== undefined && !validPixMetadata(tx.pixMetadata)) ||
      (tx.boletoInformation !== undefined && !validBoletoInformation(tx.boletoInformation))) {
    return null;
  }

  return value as unknown as SigiloPayTransactionCreatedPayload;
};

export const toSigiloPayQueuePayload = (
  payload: SigiloPayTransactionCreatedPayload,
): UnknownRecord => {
  const status = payload.transaction.status === "CHARGED_BACK"
    ? "chargeback"
    : payload.transaction.status.toLowerCase();
  const { token: _webhookToken, ...safePayload } = payload;

  return {
    ...safePayload,
    id: payload.transaction.id,
    external_transaction_id: payload.transaction.id,
    status,
    amount: payload.transaction.amount,
    currency: payload.transaction.currency,
    event_kind: status === "refunded" ? "refund" : status === "chargeback" ? "chargeback" : "payment",
  };
};
