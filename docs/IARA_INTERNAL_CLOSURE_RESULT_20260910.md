# IARA Internal Closure Result — 2026-09-10

## Scope

Internal IARA execution architecture only. No Vercel deployment and no external PSP activation are permitted in this phase.

## Executed

- Canonical Kernel uses `./tool-registry`; legacy `services/iara-agent/registry.ts` is not the canonical execution registry.
- Kernel ordering validates authorization/confirmation/idempotency/guardrail before FEB issuance.
- `iara-financial-confirm` hardened with canonical financial tool/version, tenant membership, operator role, gateway ownership/state, money/currency validation, explicit confirmation, fingerprint binding, and 60-second expiry.
- `iara-financial-command` hardened with canonical financial tool/version, tenant membership, gateway ownership/state, money/currency validation, header/body idempotency binding, independent evaluation gate, fingerprint, RS256, issuer/audience/kid, bounded ticket lifetime, UUID identity fields, and issuer idempotency reservation/completion RPCs.
- `gateway-orchestrator` v61 requires JWT + FEB, validates RS256/issuer/audience/kid/iat/exp/age, identity, tenant membership, command binding, idempotency binding, fingerprint, and immutable JTI consumption; it remains `EXECUTION_UNAVAILABLE` after successful validation because no PSP mutation is enabled.
- `checkout-engine-v2` v33 requires confirmation/evaluation and propagates `X-Althea-FEB-Ticket-Signature` to `gateway-orchestrator`.
- Direct financial writers were inspected and remain retired/fail-closed.
- Recovery function was inspected and remains requery/terminal-state/row-lock based.
- Supabase grants for new FEB idempotency RPCs are service-role only.

## Database migrations executed

- `iara_financial_authorization_evidence_v1`
- `iara_financial_confirmation_gateway_key_alignment_v1`
- `iara_feb_issuer_idempotency_boundary_v1`
- `iara_feb_issuer_idempotency_completion_v1`

The corresponding new issuer-boundary migrations are recorded in this branch.

## Objective evidence

- `gateway-orchestrator` deployed version: 61, ACTIVE, JWT required.
- `iara-financial-command` deployed version: 5, ACTIVE, JWT required.
- `iara-financial-confirm` deployed version: 2, ACTIVE, JWT required.
- `checkout-engine-v2` deployed version: 33, ACTIVE, JWT required.
- `gateway-provider-adapter` v23: HTTP 410 fail-closed.
- `gateway-provider-adapter-v2` v2: HTTP 410 fail-closed.
- `gateway-payment-link` v4: HTTP 410 fail-closed.
- `gateway-refund` v12: HTTP 410 fail-closed.
- `gateway-refund-v2` v2: HTTP 410 fail-closed.
- `althea-gateway-orchestrator` v11: HTTP 410 retired.
- `checkout-engine` v24: HTTP 410 retired.
- `feb_consumed_tickets.jti` is the primary key.
- `iara_execution_idempotency(tenant_id,idempotency_key)` is unique.
- New FEB issuer RPCs have no `anon` or `authenticated` execute grant.
- Security Advisor remaining findings are unrelated CRM/public-chat SECURITY DEFINER surfaces, RLS-no-policy informational findings on internal tables, and leaked-password protection; they were not altered because doing so would exceed the IARA closure scope without proof of architectural illegitimacy.
- Performance Advisor remaining findings are unrelated CRM/operational unused-index and one CRM foreign-key-index finding.

## Tests and validation

Static/structural validation was encoded in `.github/workflows/iara-structural-validation.yml` on `ci/iara-validation`.

The GitHub connector returned no workflow run for the branch commits, so no CI run is claimed as passed. No local Node/Deno runner was available in the execution environment with repository dependencies installed. Therefore typecheck/lint/unit/integration execution remains `UNVERIFIED_CI`, not falsely marked pass.

## External blockers

`BLOCKED_EXTERNAL_DEPENDENCY`: real PSP provider execution and provider-side idempotency cannot be proven without a real PSP, real credentials, controlled adapter activation, and end-to-end transaction evidence. Those are explicitly excluded from this phase.

`BLOCKED_EXTERNAL_DEPENDENCY`: Vercel deployment validation is intentionally not performed because Vercel deployment is excluded from this phase.

## Financial safety state

No charge, capture, refund, or void was executed. The canonical orchestrator remains fail-closed with `EXECUTION_UNAVAILABLE` and no external PSP mutation.
