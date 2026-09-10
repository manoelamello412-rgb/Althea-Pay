# IARA Internal Closure Gate

## Scope

This gate covers the internal IARA execution architecture only. External PSP credentials, external provider activation, and Vercel deployment are explicitly outside this phase.

## Required chain

`IARA → Intent Compiler → IaraExecutionKernel → Authorization → Confirmation → Idempotency → Guardrail → FEB → gateway-orchestrator → controlled adapter boundary → Recovery/Reconciliation → Independent Evaluator → Audit`

## Mandatory invariants

1. Financial effects require Kernel authorization, FEB validation, exactly-once JTI consumption, and PSP idempotency before any future external mutation.
2. `UNKNOWN_EXTERNAL_EFFECT` never performs a blind retry.
3. Tenant authority is explicit: authenticated user membership in `organization_members(organization_id,user_id)` must authorize the FEB tenant.
4. JTI uniqueness is immutable and separate from financial idempotency.
5. Financial RPCs and direct financial writers are not callable by `authenticated` or `anon` unless an explicit reviewed exception exists.
6. Direct PSP writers remain fail-closed while no external provider is connected.
7. Recovery is read-only with respect to the external provider and may finalize only from authoritative provider status.
8. CI must validate the authority graph, migrations, RLS, transaction FSM/OCC, tenant membership surface, and financial RPC privileges.
9. No Vercel deployment is required to close this internal gate.

## Current external boundary state

External PSP execution remains intentionally unavailable. This is a safety state, not an incomplete implementation defect.

## Promotion rule

Internal structural promotion is permitted only after CI passes. Financial activation remains blocked until a controlled real PSP adapter, provider idempotency, credential binding, and end-to-end evidence are connected and tested separately.
