# Organization-aware release prerequisites

This document defines the release order for PRs #109, #111 and #112 after the prerequisite hardening lands.

## Preconditions

The prerequisite migration must be applied before server-side writers that directly insert/update `integration_events` or `sales` are deployed.

The dormant legacy projectors `project_funnel_event(uuid)` and `project_checkout_purchase(uuid)` remain in the schema but lose `service_role` EXECUTE permission. They are not deleted.

The active `gateway-webhook-processor` must be live with:
- authenticated calls to `automation-engine-v2`;
- organization context derived from the canonical `gateway_transactions` row;
- no reuse of `gateway_webhook_events.id` as an `integration_events.id`.

## Etapa A — callers/writers backward-compatible

Deploy callers before the strict engine:
- `integration-event-processor` from PR #109;
- `althea-webhook` from PR #111;
- `event-worker` from PR #111;
- `funnel-events` from PR #111;
- corrected `gateway-webhook-processor` from this prerequisite lot.

These callers remain compatible with the current Automation Engine because additional `organization_id` and `sale_id` fields are additive.

Do not deploy the strict `automation-engine-v2` in this stage.

## Gate between A and B

Verify:
- all active direct Automation Engine callers either send `organization_id` or use the retry-only contract;
- no caller aliases a non-`integration_events` identifier into `event_id`;
- server-side write permissions are present only at the reviewed column scope;
- no runtime caller can execute the two dormant legacy projectors;
- CI, Security and migration audit are green.

## Etapa B — strict engine

Deploy `automation-engine-v2` from PR #111 only after the Gate A checks pass.

## Phase 2 identity migration

PR #112 remains blocked until:
1. all writers from A and the engine from B are live;
2. PR #112 is rebased on the new main;
3. migration tests/audit are rerun;
4. live schema is rechecked;
5. `integration_events` contains no `external_id is not null and event_key is null` rows.

Only then may the #112 migration be considered for application.
