# API Documentation

This file lists the current public-facing Edge Functions (`supabase/functions/**`) that ALTHEA PAY exposes to funnels, payment gateways, and third-party integrators. Internal-only functions (workers, processors) are not listed here.

## For payment gateways (server-to-server, signed webhooks)

- `POST /gateway-webhook?provider=<name>` — inbound webhook receiver for a configured payment gateway. Requires `x-webhook-signature` / `x-webhook-timestamp` (HMAC-SHA256, 5 minute tolerance).
- `POST /gateway-sandbox/charge` — sandbox/test gateway for local development.

## For funnels (checkout + event ingestion)

- `POST /checkout-engine-v2` — creates/advances a checkout session and triggers the charge. Requires a user session (`Authorization: Bearer <supabase-jwt>`).
- `POST /gateway-orchestrator` — routes an authorized charge to the configured gateway. Requires a user session.
- `POST /gateway-refund` — issues a refund for a transaction. Requires a user session.
- `POST /funnel-events` — ingests funnel/quiz/checkout lifecycle events. Accepts either an `x-funnel-event-token` (per-funnel ingestion token) or an ALTHEA API key.

## For third-party integrators (customer-configured webhooks)

- `POST /althea-webhook/<endpoint_key>` — receiver for a webhook integration created via the dashboard (`webhook-integrations`). Requires `x-althea-signature` / `x-althea-timestamp` (HMAC-SHA256, per-integration secret).

## Public REST API (API-key authenticated)

- `GET/POST /althea-public-api/v1/<resource>` — `funnels`, `products`, `sales`, `transactions` (read), `events` (write). Requires `x-althea-api-key`. Scoped per key (`funnels:read`, `sales:read`, `events:write`, etc.), rate-limited.
- Manage API keys from the dashboard (backed by `althea-api`, session-authenticated).

## Health

- `GET /health` — service health check, no auth required.

## API versioning

- The public REST API is versioned under `/v1/` inside `althea-public-api` (e.g. `/althea-public-api/v1/sales`).

## Retired endpoints

The following functions have been retired and return `410 function_retired` with a `replacement` field. Update any integration still pointing at these:

| Retired | Replacement |
|---|---|
| `automation-engine` | `automation-engine-v2` |
| `checkout-engine` | `checkout-engine-v2` |
| `integration-webhook` | `althea-webhook` |
| `api` | `althea-public-api` (external) / `althea-api` (dashboard session) |
