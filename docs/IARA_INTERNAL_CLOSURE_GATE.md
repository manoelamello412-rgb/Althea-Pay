# IARA Internal Closure Gate

## Scope

This gate covers the internal IARA execution architecture only. External PSP credentials, external provider activation, and Vercel deployment are explicitly outside this phase.

## Required chain

`IARA → Intent Compiler → IaraExecutionKernel → Authorization → Confirmation → Idempotency → Guardrail → FEB → gateway-orchestrator → controlled adapter boundary → Recovery/Reconciliation → Independent Evaluator → Audit`

## Mandatory invariants

1. Financial effects require Kernel authorization, explicit confirmation, FEB validation, exactly-once JTI consumption, and PSP idempotency before any future external mutation.
2. `UNKNOWN_EXTERNAL_EFFECT` never performs a blind retry.
3. Tenant authority is explicit: authenticated user membership in `organization_members(organization_id,user_id)` must authorize the FEB tenant.
4. JTI uniqueness is immutable and separate from financial idempotency.
5. Financial RPCs and direct financial writers are not callable by `authenticated` or `anon` unless an explicit reviewed exception exists.
6. Direct PSP writers remain fail-closed while no external provider is connected.
7. Recovery is read-only with respect to the external provider and may finalize only from authoritative provider status.
8. CI must validate the authority graph, migrations, RLS, transaction FSM/OCC, tenant membership surface, financial RPC privileges, FEB authorization evidence, and checkout FEB propagation.
9. No Vercel deployment is required to close this internal gate.

## FEB issuance evidence gate

`iara-financial-command` now requires all of the following before issuing a financial FEB ticket:

- authenticated identity;
- authorized `organization_members` membership with an operator-capable role;
- gateway ownership and connected/degraded gateway state;
- exact command binding and canonical request fingerprint;
- an unconsumed explicit confirmation record from `iara-financial-confirmations`;
- an independent `iara_evaluations` record for the same tenant and execution with `PASS` and minimum evidence/grounding/confidence/tool-call thresholds;
- RS256 key material plus issuer/audience/kid metadata.

The confirmation record is single-use and expires after 60 seconds. The FEB issuer consumes it atomically before returning a ticket. No PSP mutation is performed by this issuer.

## Checkout boundary

`checkout-engine-v2` preserves its existing checkout/session, idempotency, event, sale-projection, attribution, and integration-event logic, while requiring `tenant_id`, `gateway_id`, `confirmation_id`, and `evaluation_id` for purchase execution. It requests the FEB from `iara-financial-command` and propagates the resulting ticket through `X-Althea-FEB-Ticket-Signature` to `gateway-orchestrator`.

## Current external boundary state

External PSP execution remains intentionally unavailable. This is a safety state. The internal FEB evidence boundary is implemented, but a real PSP adapter/provider idempotency test remains an external dependency.

## Promotion rule

Internal structural promotion is permitted only after CI passes. Financial activation remains blocked until a controlled real PSP adapter, provider idempotency, credential binding, and end-to-end evidence are connected and tested separately.
