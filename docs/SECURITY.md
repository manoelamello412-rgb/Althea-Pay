# Security and Hardening

ALTHEA PAY is a non-custodial control plane. Security controls are designed to prevent cross-tenant access, replay, credential leakage and accidental payment-card handling.

## Implemented in code/database

- Timestamped HMAC helper using `sha256=<HMAC(secret, timestamp + '.' + raw_body)>` with constant-time comparison.
- Webhook handlers enforce a five-minute replay window and event deduplication.
- Gateway transaction and checkout idempotency constraints exist in PostgreSQL.
- API keys are hashed and support scoped access, rotation and revocation.
- Funnel event ingestion supports per-funnel hashed event tokens.
- Structured logging redacts token/secret/password/authorization/cookie/PAN/CVC/CVV/card fields.
- Public financial/compliance/audit tables use tenant ownership and RLS.
- CSP/HSTS and browser hardening headers are defined for the Next.js deployment surface.
- Audit trail and financial reconciliation foundations are source-controlled.

## Secrets

Never commit service-role keys, gateway credentials or webhook secrets. Production secrets belong in Supabase/Vercel secret storage or an approved external KMS/Vault.

The current webhook schema still contains a legacy plaintext `secret` column for compatibility. This is a production hardening item: migrate existing integrations to encrypted/Vault-backed secret retrieval before real gateway credentials are onboarded.

## PCI-safe architecture

- Card data MUST be collected through hosted fields/tokenization provided by the external payment provider.
- ALTHEA PAY must never persist PAN or CVC.
- Operational logs, reconciliation records and DLQ payloads must be sanitized before persistence.

## Critical external security finding

Supabase currently reports RLS disabled on `private.api_request_logs` and `private.api_rate_limit_buckets`. These tables are intentionally private/internal, but the project security advisor requires RLS to be enabled with explicit policies before treating them as production-hardened. This cannot be auto-applied safely without deciding the exact service-role access policy.

Supabase Auth also reports leaked-password protection disabled. Enable it before production onboarding.
