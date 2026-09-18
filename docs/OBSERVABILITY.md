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

The NOC consolidates bounded, sanitized operational signals from active `pg_cron` jobs, API request telemetry, integration-event retries, gateway webhooks and gateway operations, automation executions, CRM outbox delivery, outbound webhooks, reconciliation, checkout Recovery, funnel commands, production readiness gates and persisted platform health checks.

Raw payloads, readiness evidence, provider error bodies, authorization data and cron command text are intentionally not returned to the browser. The legacy CRM observability page redirects to the canonical NOC and the old `/api/crm/observability` endpoint has been removed.

The NOC polls every 30 seconds for scheduler/readiness state and also refreshes from tenant-scoped realtime changes on operational tables. Historical cron inspection is server-side and bounded to the most recent run window.

## Monitoring backend

Provider-managed logs are currently the source of truth. Prometheus/Grafana/OpenTelemetry/Sentry integration remains deployable as a separate adapter when monitoring credentials/workspace are provisioned.
