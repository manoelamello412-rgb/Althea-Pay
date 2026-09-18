# Observability

ALTHEA PAY uses structured operational signals without cardholder data.

## Required correlation fields

`request_id`, `user_id`/merchant identifier, `funnel_id`, `transaction_id`, `checkout_id`, `event_id`, gateway and operation where applicable.

Never log PAN, CVC/CVV, authorization headers, API keys, webhook secrets, passwords or raw payment credentials.

## Core metrics

- API request count and error rate.
- p50/p95/p99 latency.
- Gateway authorization rate by gateway/funnel/product.
- Gateway technical failure rate.
- Fallback rate and circuit/health-guard skips.
- Webhook received/delivered/failed/duplicate rate.
- Integration event pending/retry/failed counts.
- Worker processing latency and DLQ size.
- Checkout abandonment and recovery rate.
- Reconciliation mismatch count and discrepancy amount.
- Chargeback/dispute volume and SLA age.

## Initial SLO targets

- Critical API availability: 99.95% target after production traffic baseline exists.
- Critical API p95: <300 ms target where the request does not wait on an external PSP.
- P1 MTTR: <1 hour target once on-call exists.

These are targets, not achieved measurements. They must be validated against production telemetry.

## Alerts

Alert on sustained critical API errors, gateway degradation, webhook failure spikes, worker backlog, DLQ growth and reconciliation discrepancies. Alert thresholds should be tuned after baseline traffic is available.


## Canonical operations surface

The authenticated operations surface is `/dashboard/noc`, backed by `public.noc_operations_v1(integer)`.

The NOC consolidates bounded, sanitized operational signals from:

- active `pg_cron` jobs and the latest bounded run history;
- API request counts, 5xx rate and p95 latency;
- integration-event retries/failures;
- gateway webhook and gateway operation failures;
- automation execution failures;
- CRM outbox delivery failures;
- outbound webhook failures;
- reconciliation exceptions;
- checkout Recovery failures;
- funnel command failures;
- production readiness gates;
- persisted platform health checks.

Raw payloads, readiness evidence, provider error bodies, authorization data and cron command text are intentionally not returned to the browser.

The CRM observability page is legacy navigation only and redirects to the canonical NOC. The previous `/api/crm/observability` endpoint was removed after no remaining repository consumers were found.

The NOC polls every 30 seconds for scheduler/readiness signals and also subscribes to tenant-scoped realtime changes for operational tables. Direct historical scans remain server-side and bounded.

## Monitoring backend

Provider-managed logs are currently the source of truth. Prometheus/Grafana/OpenTelemetry/Sentry integration remains deployable as a separate adapter when monitoring credentials/workspace are provisioned.
