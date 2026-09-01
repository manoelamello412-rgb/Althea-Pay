# ALTHEA PAY Public API

Base path: `/v1`

Authentication uses an ALTHEA API key. Never send a service-role key from a browser.

## Read endpoints
- `GET /v1/funnels`
- `GET /v1/funnels/:id`
- `GET /v1/products`
- `GET /v1/products/:id`
- `GET /v1/sales`
- `GET /v1/transactions`

## Event ingestion
`POST /v1/events`

Example:

```json
{
  "event_type": "checkout_started",
  "funnel_id": "funnel-id",
  "external_id": "provider-event-123",
  "session_key": "session-123",
  "payload": { "checkout_id": "checkout-id" }
}
```

The ingestion layer validates the API key scope, checks tenant ownership, applies rate limiting and deduplicates external IDs.

## API key lifecycle
`BLOQUEIO EXTERNO`: production secret provisioning/rotation policy must be configured in the deployment environment. Keys must be shown only at creation/rotation time and stored as hashes server-side.

## Safety
- Do not put PAN/CVC in API payloads.
- Use idempotency/external IDs for retriable commands/events.
- Treat all inbound fields as untrusted.
