# API Documentation

This file lists the current public-facing Edge Functions (`supabase/functions/**`) that ALTHEA PAY exposes to funnels, payment gateways, and third-party integrators. Internal-only functions (workers, processors) are not listed here.

## For payment gateways (server-to-server, signed webhooks)

- `POST /gateway-webhook?provider=<name>` — inbound webhook receiver for a configured payment gateway. Requires `x-webhook-signature` / `x-webhook-timestamp` (HMAC-SHA256, 5 minute tolerance).
- `POST /gateway-sandbox/charge` — sandbox/test gateway for local development.

## For funnels (checkout + event ingestion)

- `POST /checkout-engine-v2` — creates/advances a checkout session and triggers the charge. Requires a user session (`Authorization: Bearer <supabase-jwt>`).
- `POST /gateway-orchestrator` — routes an authorized charge to the configured gateway. Requires a user session.
- `POST /funnel-client-token` — issues a 10-minute `events:write` browser token. Server side with the secret `x-funnel-event-token`, or from a page with only `funnel_id` when the browser `Origin` matches the funnel's page URL.
- `POST /funnel-events` — ingests funnel/quiz/checkout lifecycle events. Accepts a client token (`x-funnel-client-token`), the per-funnel `x-funnel-event-token`, or an ALTHEA API key.

## Page snippet (`althea.js`)

Paste in every page of the funnel, before `</head>`. The dashboard (Funil → Estado da Integração) shows it ready to copy:

```html
<script async src="https://<app>/althea.js" data-funnel-id="<funnel_id>" data-api="https://<project>.supabase.co"></script>
```

- Requires the funnel's "Link da Página" to be saved: tokens are only issued to that host (`www.` ignored). The ingestion token is never placed in the page.
- Sends `page_view` on load with a persistent `visitor_id`, a `session_id` (30 min idle), `page_url`, `referrer` and the session's UTMs / `gclid` / `fbclid`.
- `althea.identify({ name, email, phone, customer_id })` attaches the buyer to the following events (feeds canonical customer resolution).
- `althea.track('checkout_started', { product_id, checkout_id })` sends any catalog event; each call gets a unique `event_id`, or pass your own to make retries idempotent.

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
