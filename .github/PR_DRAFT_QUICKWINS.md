# PR Draft: Quick-wins + DB-ready changes (ci-security-hardening)

This PR adds a set of quick-win improvements and DB-ready scaffolding to accelerate getting Althea Pay to a testable, secure, and production-ready state.

What this PR includes
- Validation (Zod) for charge payloads and webhook events
- Structured JSON logging + request_id helper
- In-memory idempotency helper with DB-upgrade path
- Webhook ingestion function (HMAC verify, timestamp check, schema validation)
- Event worker skeleton (HTTP invocable, retries/DLQ logic placeholder)
- OpenAPI v3 stub + Postman collection + minimal SDK quickstart
- CI e2e-smoke workflow (runs tests without DB)
- RLS policy templates (do NOT apply automatically)
- Stripe adapter skeleton (supabase/functions/adapters/stripe.ts)

Why these changes
- Provide a safe, testable environment for developers and integrators
- Enforce basic security hygiene (HMAC verification, idempotency) even before DB provisioning
- Prepare the codebase for DB-backed transactional guarantees and RLS

How to test (short)
1. Checkout branch: `git fetch && git checkout ci-security-hardening`
2. `npm ci` and `npm test`
3. Run webhook simulation against `supabase/functions/integration-webhook` and inspect logs

Blocking items (external) — what we still need you to provide
- `DATABASE_URL` (staging Postgres/Supabase) to replace in-memory fallbacks
- `SUPABASE_SERVICE_ROLE` to safely apply RLS/migrations
- `ALTHEA_WEBHOOK_SECRET` to validate webhook HMACs in CI/staging
- PSP sandbox keys (e.g., `PSP_STRIPE_KEY`) for adapter validation

Recommended next steps
- Add the above secrets to GitHub Actions secrets
- Allow CI to run DB-backed E2E tests (I will replace fallbacks once secrets are available)
- Review and merge this PR; after merge I can open follow-up PRs to implement DB-backed idempotency, webhook persistence, reconciliation, and chargeback flows

Checklist (to be verified in PR review)
- [ ] Unit tests pass
- [ ] E2E smoke tests pass on CI (without DB)
- [ ] No secrets committed
- [ ] RLS templates reviewed by security team
- [ ] Plan for DB substitution agreed

If you want, I can open this PR draft for you automatically (requires permission) or you can open it manually using the compare link:
https://github.com/manoelamello412-rgb/Althea-Pay/compare/main...ci-security-hardening?expand=1
