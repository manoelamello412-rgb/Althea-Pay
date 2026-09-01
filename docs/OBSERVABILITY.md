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

## Monitoring backend

Provider-managed logs are currently the source of truth. Prometheus/Grafana/OpenTelemetry/Sentry integration remains deployable as a separate adapter when monitoring credentials/workspace are provisioned.
