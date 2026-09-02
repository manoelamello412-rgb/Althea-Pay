# Reconciliation & Financial Mirror

ALTHEA PAY is a non-custodial control plane. Financial tables mirror external gateway state; they do not represent funds held by ALTHEA.

## Reconciliation model

`reconciliation_runs` records a bounded reconciliation window per merchant/gateway. `reconciliation_items` records the match decision for each external transaction.

Supported outcomes:

- `matched`
- `amount_mismatch`
- `missing_internal`
- `missing_gateway`
- `duplicate`
- `unmatched`

A reconciliation run should compare gross, fees and net values and persist the discrepancy instead of silently overwriting internal state.

## Daily workflow

1. Import or receive the gateway settlement/report.
2. Create a `reconciliation_runs` record with the exact period and source reference.
3. Match external transaction IDs first, then apply a controlled secondary matching strategy.
4. Write one `reconciliation_items` row per report record.
5. Aggregate counts and gross/fees/net totals on the run.
6. Mark the run `completed` only after every input record has a deterministic outcome.
7. Escalate non-zero discrepancies to the operations queue.

## Dead-letter queue

`event_dead_letters` is the terminal queue for integration events that remain unsuccessful after retry policy limits. It preserves the original event payload, failure reason, attempt count and resolution metadata without deleting the source event.

No PAN/CVC or raw authorization credentials may be placed in reconciliation or DLQ payloads.
