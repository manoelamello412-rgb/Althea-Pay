# ALTHEA PAY — Production Readiness

## Current technical baseline
- Supabase Auth + RLS
- Multi-funnel and multi-product data model
- Gateway routes, health intelligence and transaction ledger
- Checkout sessions/items/offers/events
- Attribution sessions and sale attribution projection
- Idempotent integration events and webhook delivery tracking
- Automation engine + retryable event worker
- Gateway Sandbox + Gateway Orchestrator
- Checkout Engine / Checkout Engine v2
- External webhook ingestion with signature validation
- Funnel event ingestion with per-funnel hashed tokens
- Realtime operational updates
- Audit/log foundation
- Organization and role foundation
- Scheduled abandoned-checkout processing
- Scheduled event-worker invocation

## GREEN — implemented in code / database
- Multi-tenant RLS model
- Payment orchestration abstraction
- Sandbox approval / decline / technical-failure simulation
- Idempotency constraints for sales, transactions, checkout and events
- Event retry policy with stale-claim recovery
- Gateway health guard and route fallback foundation
- Checkout abandonment marking and recovery state
- Attribution persistence and projection
- Webhook deduplication and signed delivery handling
- Per-funnel event ingestion tokens (hash-only persistence)
- API key scopes, rotation/revocation and rate limiting foundation
- Realtime subscriptions for operational entities
- Supabase function auth configuration synchronized in `supabase/config.toml`
- Public health endpoint source and deployment synchronized

## YELLOW — requires final technical validation
- End-to-end Sandbox checkout with an authenticated test user
- Gateway fallback under simulated technical failure
- Realtime transaction/checkout/chat verification in the deployed UI
- Multi-user role and funnel-isolation test matrix
- Load testing of event ingestion, checkout and public API
- Production webhook certification against each selected provider
- Gateway adapter certification for a real provider
- Backup restore drill and documented RTO/RPO
- Central alerting and on-call runbooks
- Reconciliation sample against real settlement data

## RED — external blockers before a real-money launch
- Production gateway/adquirer credentials and merchant onboarding
- PCI scope determination and formal compliance evidence
- KYC/AML policy and any required verification provider
- Production domain/DNS/certificates
- Production SMTP and branded transactional email
- Supabase Auth leaked-password protection must be enabled
- Owner MFA/security posture must be verified
- Legal/regulatory review for the countries and payment flows operated

## IMPORTANT INTERNAL BLOCKER
The scheduled `althea-event-worker` job is installed and active, but the database Vault currently has no `ALTHEA_INTERNAL_SECRET` value. The worker intentionally remains protected and must not be made anonymous just to make the scheduler green.

Required secure deployment action:
1. Generate a strong random internal secret outside the repository.
2. Configure the same secret as the Edge Function secret/environment variable for `event-worker` and `automation-engine-v2` (and any other internal caller that uses it).
3. Store the same secret in Supabase Vault under `ALTHEA_INTERNAL_SECRET` for the cron job.
4. Never commit or print the secret.
5. Re-run the worker scheduler smoke test after provisioning.

## Security principles
- Never place Supabase secret/service-role keys in browser code.
- Never store PAN or CVC in ALTHEA.
- Keep user-called Edge Functions authenticated.
- Keep external webhook functions unauthenticated at the platform layer only when the handler validates the provider signature.
- Use RLS for tenant isolation.
- Use idempotency and replay protection for payment/event paths.
- Keep internal workers protected by a non-public secret rather than disabling authentication.
- Keep financial settlement in external gateways; ALTHEA is the control and intelligence layer.

## Go-live rule
ALTHEA PAY must not be labelled fully production-ready until all RED items have an owner/evidence and the YELLOW technical verification suite has passed. Code readiness is not the same as regulatory, merchant, or payment-provider readiness.
