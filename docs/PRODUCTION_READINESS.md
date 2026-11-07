# ALTHEA PAY — Production Readiness

## Canonical architecture

Althea Pay is the control/orchestration layer. It does not hold funds and does not replace the connected payment provider.

Canonical runtime surfaces:
- `gateway-orchestrator` — authenticated smart-routing/orchestration path.
- `gateway-provider-adapter` — internal provider execution boundary.
- `gateway-connection-test` — validates a configured connection and updates its operational state.
- `checkout-engine-v2` — single versioned checkout engine.
- `automation-engine-v2` — single versioned automation engine.
- `althea-public-api` — public API surface.
- `althea-webhook` — canonical external integration webhook.
- `funnel-events` — canonical funnel event ingestion.
- CRM omnichannel workers/functions listed in `supabase/config.toml`.
- Iara functions listed in `supabase/config.toml`, using the configured private Althea AI engine.

Retired compatibility functions are intentionally absent from the repository. The Edge Functions deployment uses `--prune` so removed slugs are also deleted from the linked Supabase project after merge.

## GREEN — validated in the audit branch

- Dependency versions are pinned and `package-lock.json` is committed.
- TypeScript typecheck passes.
- ESLint passes with zero warnings.
- 21 test files / 77 tests pass.
- Next.js production build compiles and generates 57 pages.
- Production-safe load smoke passes.
- Release preflight passes.
- Security workflow passes.
- Supabase migration audit workflow passes.
- Release preflight reports zero unreferenced component candidates and zero unreferenced lib candidates.
- Versioned/duplicate runtime names such as V2/V3/old/legacy are absent outside migration history.
- Retired Edge Function stubs were removed from source.
- GitHub now contains every canonical Edge Function currently required by the audited runtime.
- `supabase/config.toml` explicitly records JWT behavior for canonical functions.
- Public checkout payment actions validate checkout session identity with the session idempotency key through server routes.
- Checkout no longer depends on public browser access to transaction-status RPCs.
- Gateway ranking uses the current `gateway_runtime_route_candidates` RPC.
- Gateway connection UI uses one canonical connector and no longer reads the removed `gateways.priority` column.
- Generic HTTP providers expose the transport fields required to configure them from the operator UI.
- CRM outbox dispatcher source matches the working deployed implementation family and is syntactically valid.
- Active Iara functions that previously existed only in Supabase are versioned in GitHub.
- Security hardening revokes unintended anonymous execution from administrative SECURITY DEFINER functions.
- The funnel commercial view is switched to security-invoker behavior.
- Plaintext gateway credential resolution is service-role-only.
- Audit, sales and company/settings screens use columns/tables that exist in the current Supabase schema.
- Supabase Vault contains an `ALTHEA_INTERNAL_SECRET` entry.
- Existing internal pg_cron jobs are active; the audit migration adds the missing canonical CRM worker schedules.

## YELLOW — environment/E2E validation still required

These checks require live provider credentials, live external systems or a deployable preview environment:
- End-to-end checkout with a real supported provider.
- Real PIX creation, QR/copy-paste payload, provider confirmation and webhook transition.
- Controlled technical-failure test proving safe failover behavior without ambiguous duplicate charging.
- Realtime checkout/chat/customer support test in the deployed browser UI.
- Multi-user role and tenant-isolation browser test matrix.
- Production webhook certification for each enabled provider.
- Reconciliation sample against real provider settlement data.
- Backup restore drill and documented RTO/RPO.
- Central alerting/on-call runbook.
- The two integration suites that intentionally require external/runtime fixtures remain skipped in ordinary CI.
- Vercel preview is currently unavailable because the account has hit its build-rate limit; GitHub's independent production build is green.

## RED — external/business blockers before real-money launch

- Production gateway/adquirer credentials and merchant onboarding.
- PCI scope determination and formal compliance evidence.
- KYC/AML policy and any required verification provider.
- Production domain/DNS/certificates.
- Production SMTP and branded transactional email.
- Supabase Auth leaked-password protection must be enabled if not already enabled.
- Owner MFA/security posture must be verified.
- Legal/regulatory review for every country/payment flow operated.

## Database deployment rule

GitHub and the live Supabase project previously had different migration histories. Automatic `supabase db push` remains forbidden in CI until the histories are explicitly reconciled.

Before applying new database changes:
1. Compare `supabase migration list --linked` with the repository.
2. Pull/reconcile the live schema/history if necessary.
3. Review the exact SQL diff.
4. Apply only reviewed forward migrations.
5. Never rebuild production from the old local migration history as a substitute for reconciliation.

## Edge Function deployment rule

The repository is the canonical Edge Function inventory. On `main`, the deployment workflow runs:

`supabase functions deploy --project-ref hkraryqoziravulvqkid --prune`

This deploys canonical functions and removes remote functions intentionally retired from source.

## Security principles

- Never place service-role or provider secrets in browser code.
- Never store PAN/CVC in Althea.
- Keep user-facing privileged functions JWT-authenticated.
- Keep external webhooks platform-anonymous only when the handler validates a provider signature/token.
- Keep internal workers guarded by `ALTHEA_INTERNAL_SECRET`.
- Use RLS and organization context for tenant isolation.
- Use idempotency/replay protection for payment and event paths.
- Preserve the original provider/gateway on historical transactions when routing changes.
- Keep settlement/funds at the external gateway; Althea remains the control and intelligence layer.

## Go-live rule

Code readiness is not the same as real-money production readiness.

The audited branch may be merged when GitHub checks remain green and the migration diff is accepted. Real-money go-live still requires the YELLOW live E2E checks and RED external/compliance items above.
