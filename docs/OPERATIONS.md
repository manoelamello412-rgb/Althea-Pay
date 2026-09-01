# Operations Runbook

This document contains runbooks for common operational tasks.

1) Process DLQ (webhook_events_dlq)
- Query DLQ: SELECT * FROM webhook_events_dlq ORDER BY moved_at DESC LIMIT 100;
- Inspect the payload and reason column, classify error (invalid payload / transient error / mapping issue).
- If fixable, re-insert into webhook_events with next_attempt_at = now() and delete from DLQ.

2) Reconciliation triage
- Run reconciliation-worker with sample settlement file.
- Use admin UI (or psql) to inspect reconciliations WHERE matched = false.
- Attempt manual matching using ledger_transactions and create reconciliation records.

3) Rotate ALTHEA_WEBHOOK_SECRET
- Generate new secret in KMS.
- Update GitHub Secret ALTHEA_WEBHOOK_SECRET in repo Settings -> Secrets.
- Deploy updated function and monitor webhook signatures for failures.

4) Emergency incident (P1)
- Pager duty / on-call notified.
- Triage: check DLQ growth, worker errors, API latency, recent deploys.
- Rollback: revert to previous stable commit and redeploy.

