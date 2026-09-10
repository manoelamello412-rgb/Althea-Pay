import { importJWK, jwtVerify, type JWK, type JWTPayload } from "npm:jose@6.1.0";

export type IaraFEBAction = "purchase" | "capture" | "refund" | "void";

export interface IaraFEBClaims extends JWTPayload {
  jti: string;
  executionId: string;
  tenantId: string;
  userId: string;
  toolKey: string;
  toolVersion: number;
  gatewayId: string;
  action: IaraFEBAction;
  idempotencyKey: string;
  requestFingerprint: string;
  iss: string;
  aud: string | string[];
  kid: string;
}

export interface FEBValidationInput {
  request: Request;
  body: Record<string, unknown>;
  userId: string;
  tenantId: string;
  gatewayId?: string;
  action: IaraFEBAction;
}

export interface FEBValidationResult {
  ok: true;
  claims: IaraFEBClaims;
  token: string;
}

export interface FEBValidationFailure {
  ok: false;
  status: 401 | 403 | 409;
  code: "TICKET_INVALID" | "TICKET_EXPIRED" | "TICKET_IDENTITY_MISMATCH" | "TICKET_COMMAND_MISMATCH" | "TICKET_REPLAYED" | "FEB_CONFIGURATION_ERROR";
}

const HEADER = "x-althea-feb-ticket-signature";
const DEFAULT_AUDIENCE = "althea-pay:gateway-orchestrator";
const DEFAULT_ISSUER = "althea-pay:iara-kernel";
const MAX_TICKET_AGE_SECONDS = 60;
const CLOCK_SKEW_SECONDS = 10;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!record(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(stable(value));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeJwkSet(): JWK[] {
  const raw = Deno.env.get("IARA_FEB_JWKS_JSON");
  if (!raw) throw new Error("IARA_FEB_JWKS_JSON is not configured");
  const parsed: unknown = JSON.parse(raw);
  if (!record(parsed) || !Array.isArray(parsed.keys)) throw new Error("IARA_FEB_JWKS_JSON must contain a keys array");
  return parsed.keys.filter(record) as JWK[];
}

async function verifySignature(token: string): Promise<IaraFEBClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed_jwt");
  const headerJson = JSON.parse(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")));
  if (!record(headerJson) || headerJson.alg !== "RS256" || typeof headerJson.kid !== "string") throw new Error("unsupported_feb_signature");

  const jwk = decodeJwkSet().find((candidate) => candidate.kid === headerJson.kid && candidate.alg === "RS256");
  if (!jwk) throw new Error("unknown_feb_kid");

  const issuer = Deno.env.get("IARA_FEB_ISSUER") ?? DEFAULT_ISSUER;
  const audience = Deno.env.get("IARA_FEB_AUDIENCE") ?? DEFAULT_AUDIENCE;
  const key = await importJWK(jwk, "RS256");
  const result = await jwtVerify(token, key, {
    algorithms: ["RS256"],
    issuer,
    audience,
    clockTolerance: CLOCK_SKEW_SECONDS,
  });
  return { ...result.payload, kid: String(headerJson.kid) } as IaraFEBClaims;
}

export async function validateFEB(input: FEBValidationInput): Promise<FEBValidationResult | FEBValidationFailure> {
  const token = input.request.headers.get(HEADER)?.trim();
  if (!token) return { ok: false, status: 401, code: "TICKET_INVALID" };

  let claims: IaraFEBClaims;
  try {
    claims = await verifySignature(token);
  } catch {
    return { ok: false, status: 403, code: "TICKET_INVALID" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (!claims.jti || !claims.executionId || !claims.tenantId || !claims.userId || !claims.toolKey || !Number.isInteger(claims.toolVersion) || !claims.gatewayId || !claims.action || !claims.idempotencyKey || !claims.requestFingerprint || !claims.iss || !claims.aud || !claims.kid) {
    return { ok: false, status: 403, code: "TICKET_INVALID" };
  }
  if (typeof claims.iat !== "number" || typeof claims.exp !== "number" || claims.iat > now + CLOCK_SKEW_SECONDS || now > claims.exp || now - claims.iat > MAX_TICKET_AGE_SECONDS) {
    return { ok: false, status: 403, code: "TICKET_EXPIRED" };
  }
  if (claims.userId !== input.userId || claims.tenantId !== input.tenantId) return { ok: false, status: 403, code: "TICKET_IDENTITY_MISMATCH" };
  if (claims.action !== input.action || (input.gatewayId && claims.gatewayId !== input.gatewayId)) return { ok: false, status: 403, code: "TICKET_COMMAND_MISMATCH" };

  const fingerprintInput = {
    ...input.body,
    tenant_id: input.tenantId,
    user_id: input.userId,
    gateway_id: claims.gatewayId,
    action: input.action,
    execution_id: claims.executionId,
    idempotency_key: claims.idempotencyKey,
  };
  const fingerprint = await sha256Hex(canonicalJson(fingerprintInput));
  if (fingerprint !== claims.requestFingerprint) return { ok: false, status: 403, code: "TICKET_COMMAND_MISMATCH" };

  return { ok: true, claims, token };
}

export { canonicalJson, sha256Hex, MAX_TICKET_AGE_SECONDS };
