# ALTHEA PAY Operations Runbook

## P1: payment processing degradation

1. Check `/functions/v1/health`.
2. Inspect gateway operation success rate and recent failures.
3. Confirm whether the issue is provider-specific or platform-wide.
4. Disable the affected route only if the route configuration is known to be unsafe.
5. Preserve request IDs, transaction IDs and timestamps for investigation.
6. Do not retry card declines as technical failures.
7. Escalate provider incidents with sanitized evidence.

## P1: event backlog

1. Inspect `integration_events` for `pending`, `retry` and stale `processing` records.
2. Check `event-worker` logs.
3. Verify the internal secret is configured and has not expired/rotated.
4. Inspect `event_dead_letters` after retry exhaustion.
5. Replay only with the original event identity/idempotency semantics.

## Backup / restore

### Objectives

- Target RPO: 24 hours until a dedicated backup policy is configured.
- Target RTO: 4 hours until a tested restore environment is established.
- Never treat a logical backup as a substitute for provider-managed backups.

### Procedure

1. Record the incident and last known-good migration.
2. Obtain the latest provider backup/export using credentials stored outside the repository.
3. Restore into an isolated staging project/database.
4. Validate schema/migrations, RLS, row counts and critical invariants.
5. Run sandbox checkout → gateway → webhook → worker smoke tests.
6. Only after validation, follow the provider's production recovery procedure.

No backup artifact, database password, service-role key or gateway credential belongs in Git.

## Release / rollback

1. CI must be green before merge.
2. Run migration preflight before applying schema changes.
3. Prefer additive, backward-compatible migrations.
4. Deploy application/functions before removing compatibility paths.
5. For a failed release, roll back application/function version first when possible.
6. Never blindly reverse a production migration; use a forward corrective migration unless a verified rollback exists.
7. Record the release SHA, migration version and incident timeline.

## Tabletop validation

Quarterly, simulate:

- provider outage + fallback;
- duplicated webhook;
- worker outage and retry backlog;
- reconciliation discrepancy;
- failed deployment;
- database restore.
