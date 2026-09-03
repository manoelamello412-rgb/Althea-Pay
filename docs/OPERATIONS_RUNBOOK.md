# ALTHEA PAY — Operations Runbook

## Scope
Operational procedures for the control plane, payment orchestration, webhooks, workers, reconciliation and incident response. ALTHEA PAY does not hold settlement funds and must never persist PAN/CVC.

## 1. Incident triage

1. Check the public health endpoint.
2. Check Edge Function runtime errors and identify the affected function/route.
3. Check gateway health/routing telemetry before changing provider configuration.
4. Preserve the transaction id, idempotency key, external transaction id and correlation/event id.
5. Do not retry a payment solely because a customer-facing request timed out; inspect transaction state first.

## 2. Payment failure policy

- `technical`, `timeout`, `unavailable`: eligible for controlled gateway failover according to routing policy.
- `declined`, `fraud`, `pending`: never fail over automatically.
- A retry must preserve the checkout/cart context and idempotency semantics.
- Refunds must reference the original approved transaction and use the original gateway/provider.

## 3. Webhook incident

1. Verify provider signature and timestamp/replay window.
2. Confirm the provider event id is unique before projecting state.
3. Confirm tenant/funnel/gateway ownership.
4. Inspect the transaction's current state and legal transition before any correction.
5. Reprocess through the idempotent worker path; do not manually bypass the transaction state machine.

## 4. Worker incident

Protected internal workers require `ALTHEA_INTERNAL_SECRET`.

- Never disable authentication to make a scheduler green.
- If the secret is missing from Vault, provision it through the secret-management path and rerun the scheduler smoke test.
- Inspect stale claims and retry/dead-letter state before re-running batches.
- Avoid duplicate execution by respecting claim ownership and idempotency keys.

## 5. Reconciliation incident

Expected outcomes include `matched`, `amount_mismatch`, `missing_internal`, `missing_gateway` and `duplicate`.

- Never resolve a mismatch by editing the ledger directly.
- Compare stable external transaction identifiers, amount and currency first.
- Preserve the reconciliation run and evidence for audit.
- Provider settlement certification remains a production prerequisite.

## 6. Security incident

- Rotate the affected credential immediately through the provider/Vault mechanism.
- Never commit secrets, print secrets or place service-role keys in browser code.
- Never collect PAN/CVC in ALTHEA.
- Preserve audit evidence and timestamps.
- If tenant isolation is suspected, stop the affected write path and investigate RLS plus server-side ownership checks before resuming traffic.

## 7. Database recovery / restore drill

A restore drill must use an isolated Supabase environment, never production. Validate, at minimum:

- schema/migration consistency;
- RLS and function execution privileges;
- gateway transaction state-machine integrity;
- idempotency constraints;
- webhook/event deduplication;
- scheduled worker authorization;
- application smoke tests.

Record RTO, RPO, restore start/end timestamps and the migration version used. Do not claim a restore drill passed until the isolated environment has been exercised.

## 8. Release gate policy

A release is not considered fully production-ready while any required technical gate is pending or any regulatory/provider prerequisite is unresolved. A green CI build proves code quality checks only; it does not certify merchant onboarding, PCI scope, KYC/AML, provider credentials, backup recovery or legal compliance.

## 9. Safe rollback principles

- Prefer configuration/routing rollback over database mutation.
- Do not delete financial records to correct an operational error.
- Preserve immutable audit evidence.
- For an incorrect transaction state, use the approved state-transition/reconciliation workflow.
- Disable a failing gateway route rather than bypassing risk, idempotency or webhook verification.

## 10. Go-live checklist

Before real-money traffic, owners must explicitly close:

- authenticated sandbox E2E;
- technical-failure gateway failover;
- realtime UI verification;
- multi-user tenant/role isolation matrix;
- load tests covering event ingestion, checkout and public API;
- provider webhook certification;
- real gateway adapter certification;
- backup restore drill with RTO/RPO;
- central alerting and on-call runbooks;
- real settlement reconciliation sample;
- production credentials/merchant onboarding;
- PCI/KYC/AML/legal requirements;
- DNS/certificates and transactional email;
- owner MFA/security posture.
