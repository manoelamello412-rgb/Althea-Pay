# PR Template: Quick-wins + DB-ready changes

## Title
chore(ci-security-hardening): quick-wins, webhook, worker, idempotency, OpenAPI, Stripe adapter skeleton

## Description
This PR contains a set of quick-win improvements and DB-ready scaffolding to accelerate getting Althea Pay to a testable, secure, and production-ready state. See `.github/PR_DRAFT_QUICKWINS.md` for full details.

## Changes
- Validation (Zod) for charge payloads and webhook events
- Structured logging + request_id helper
- In-memory idempotency helper (DB-ready)
- Webhook ingestion function with HMAC + timestamp protection
- Event worker skeleton (no-op without DB)
- OpenAPI stub + Postman collection + SDK quickstart example
- CI e2e-smoke workflow
- RLS templates (do NOT apply automatically)
- Gateway adapter interface + Stripe adapter skeleton

## Checklist
- [ ] Unit tests added for new modules
- [ ] E2E smoke tests pass on CI (no DB)
- [ ] No secrets are committed
- [ ] RLS templates reviewed by security team
- [ ] Plan for DB substitution agreed

## Notes for reviewers
- Branch: `ci-security-hardening`
- Compare link: https://github.com/manoelamello412-rgb/Althea-Pay/compare/main...ci-security-hardening?expand=1
- To fully validate DB-backed flows, add `DATABASE_URL`, `SUPABASE_SERVICE_ROLE`, and `ALTHEA_WEBHOOK_SECRET` as GitHub Secrets.

