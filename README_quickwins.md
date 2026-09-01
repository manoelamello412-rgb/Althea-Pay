# Althea Pay — critical hardening

The `ci-security-hardening` branch contains production-oriented foundations for webhook security, idempotency, event processing, sandbox simulation, reconciliation/DLQ, API keys, RLS templates and CI validation.

The payment flow uses Postgres-backed uniqueness and idempotency records; sandbox and orchestrator mutators require an `Idempotency-Key`/`X-Idempotency-Key` header.

Webhook ingestion uses timestamped HMAC-SHA256 verification and event deduplication. The event worker is protected by `ALTHEA_INTERNAL_SECRET` and retries through the database retry policy.

The platform never stores PAN/CVC and does not hold merchant sales funds.

Remaining production blockers include enabling Supabase Auth leaked-password protection, configuring the internal worker secret, hardening webhook secret storage, and external PSP/PCI/KYC/AML evidence.