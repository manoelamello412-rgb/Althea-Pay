# Security and Hardening

This document lists security controls implemented in-repo and guidance for deployment.

Implemented (code-level)

- HMAC verification helper for webhook signature validation (lib/hmac.ts).
- Idempotency helper with DB-backed or in-memory fallback (lib/idempotency.ts).
- HTTP handlers (supabase/functions/*) validate Idempotency-Key header and use HMAC for webhook verification where applicable.
- RLS: migrations create ownership columns and audit tables; RLS policies must be applied in Supabase console (BLOQUEIO EXTERNO).
- CSP/HSTS: Add in next config or platform (BLOQUEIO EXTERNO for platform settings).

Secrets

- Never commit secrets. Use environment variables (DATABASE_URL, SANDBOX_URL, GATEWAY_*).

PCI-safe architecture

- Card data MUST be collected via hosted fields or tokenization provided by each gateway.
- ALTHEA PAY only stores token references (gateway_token, card_last4, card_brand).

Operational guidance

- Service role keys belong to Supabase env; restrict them to CI/CD and serverless functions.
- Rotate keys periodically.

Files added:
- docs/SECURITY.md
