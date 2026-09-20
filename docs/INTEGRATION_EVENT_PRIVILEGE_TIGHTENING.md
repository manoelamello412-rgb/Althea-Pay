# Integration event privilege tightening after Gate A

The DB contract in PR #114 intentionally does **not** revoke the existing table-level
`UPDATE` privilege that `service_role` currently has on `public.integration_events`.

This is a transitional compatibility allowance only.

A later, dedicated migration may revoke that privilege **only after Gate A**, when all live
server-side callers that mutate integration-event lifecycle state have been verified to use
the approved lifecycle RPCs:

- `server_claim_integration_event_v1`
- `server_complete_integration_event_v1`
- `server_fail_integration_event_v1`
- other pre-existing narrowly-scoped lifecycle RPCs only where explicitly retained

Before that tightening migration is created/applied, verify:

1. no live Edge Function performs direct `.from("integration_events").update(...)`;
2. Stage A callers are deployed and healthy;
3. lifecycle transitions preserve retry counters, claim attempts, timestamps and dead-letter behavior;
4. no active SQL/cron/runtime caller requires direct table UPDATE;
5. service_role RPC execution is restricted to the approved internal contracts.

Expected postcondition of the later migration:

`service_role` has no direct INSERT or UPDATE on `public.integration_events`; server-side
mutations occur only through the approved RPC contract.

This document defines the contract only. It does not create or apply the tightening migration.
