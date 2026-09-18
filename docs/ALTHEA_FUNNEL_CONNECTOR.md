# ALTHEA PAY — Funnel Connector v1

ALTHEA PAY is the control plane, operational mirror, CRM and orchestration layer for independently hosted funnels. The funnel keeps its own domain, pages, design and checkout experience.

## Provisioning

Create or connect the funnel from ALTHEA. Product and gateway are optional during initial provisioning and may be bound later.

`POST /api/funnels/provision`

The response includes:

- a long-lived ingestion token shown once;
- the canonical event endpoint;
- the server-side client-token endpoint;
- the browser SDK URL;
- protocol version.

The long-lived `alt_fnl_...` token is a **server credential**. Never embed it in browser JavaScript.

## Browser integration

Load the official browser connector:

```html
<script src="https://YOUR-ALTHEA-DOMAIN/althea-funnel-connector.js"></script>
<script>
  window.AltheaFunnelConnector.create({
    funnelId: "YOUR_ALTHEA_FUNNEL_ID",
    tokenProvider: async () => {
      // This endpoint belongs to the external funnel.
      // It talks server-to-server to ALTHEA using the long-lived ingestion token.
      const response = await fetch("/api/althea-client-token", { method: "POST" })
      if (!response.ok) throw new Error("ALTHEA_TOKEN_UNAVAILABLE")
      return response.json()
    }
  }).then((althea) => {
    window.althea = althea
  })
</script>
```

The SDK creates stable `visitor_id` and per-tab `session_id`, captures attribution and non-sensitive device context, uses idempotent `event_id` values, keeps a bounded session queue for network failures and retries with the same event ID.

Examples:

```js
await althea.step("offer")
await althea.track("offer_viewed", { offer_id: "offer-123" })
await althea.identify({ name: "Cliente", email: "cliente@example.com" })
await althea.track("checkout_started", { checkout_id: "chk-123" })
await althea.track("pix_created", { checkout_id: "chk-123", expires_at: "2026-09-18T20:00:00Z" })
```

Raw PAN, card number, CVV or CVC are rejected by the connector and telemetry boundary.

## Server-side token exchange

The external funnel backend stores the long-lived ingestion token and exchanges it for a browser credential:

`POST /functions/v1/funnel-client-token`

Header:

`x-funnel-event-token: alt_fnl_...`

The response returns an `alt_fct_...` credential with a maximum lifetime of 10 minutes and scope `events:write`.

Browser credentials are HMAC-signed, funnel-bound and rejected if expired or used for another funnel.

## Canonical event contract

Protocol major version: `1`.

Canonical event names include:

- `session_started`, `session_ended`;
- `page_viewed`, `step_viewed`, `cta_clicked`;
- `quiz_started`, `quiz_answered`;
- `form_started`, `form_completed`, `lead_created`;
- `offer_viewed`, `order_bump_selected`, `order_bump_removed`;
- `upsell_viewed`, `upsell_accepted`, `upsell_rejected`, `downsell_viewed`;
- `checkout_started`, `checkout_identified`, `checkout_abandoned`;
- `payment_created`, `payment_pending`, `payment_processing`, `payment_approved`, `payment_failed`, `payment_expired`, `payment_cancelled`;
- `pix_created`, `pix_displayed`, `pix_copied`;
- `refund_created`, `payment_refunded`, `chargeback_created`;
- `chat_started`, `chat_message`, `conversation_assigned`, `conversation_closed`.

Legacy names remain accepted as aliases where configured in `funnel_event_types`, but new records are stored with the canonical event type and preserve the original input in `original_event_type`.

Custom events use the namespace `custom.<name>`.

## Event envelope

```json
{
  "version": "1",
  "event_id": "evt_...",
  "event_type": "page_viewed",
  "funnel_id": "funnel_...",
  "session_id": "session_...",
  "visitor_id": "visitor_...",
  "occurred_at": "2026-09-18T18:00:00Z",
  "page_url": "https://produto.example/oferta",
  "attribution": {
    "source": "meta",
    "campaign": "campanha-a"
  },
  "customer": null,
  "payload": {}
}
```

## Operational projection

Every accepted event is durably stored in `integration_events`. When `session_id` is present it also updates the existing `attribution_sessions` record, which is the canonical live session projection.

ALTHEA therefore separates:

- immutable event history for audit and replay;
- current journey/session state for operator screens.

The `v_funnel_live_journeys` view exposes active sessions from the last 15 minutes under the existing tenant/RLS boundary.

## Rate limiting and retries

Funnel/client credentials use a database-backed distributed rate limit. Current default: 600 accepted requests per minute per ingestion key.

Clients must preserve the same `event_id` when retrying the same business event.

## White-label boundary

Customer-facing pages must not render ALTHEA branding unless the merchant explicitly chooses to do so. ALTHEA remains the private operating layer behind the external funnel.

## Gateway and secret boundary

The browser connector never receives gateway credentials. Payment and gateway mutations remain server-side and are handled by the gateway/control-plane runtime.
