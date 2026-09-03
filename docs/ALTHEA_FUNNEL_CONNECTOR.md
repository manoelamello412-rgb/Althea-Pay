# ALTHEA PAY — Funnel Connector Contract

This document defines the integration boundary for any future funnel. A funnel is an independent application; ALTHEA PAY is the control plane, financial mirror, CRM and orchestration layer.

## Provisioning

Authenticated operators provision a funnel through:

`POST /api/funnels/provision`

Request:

```json
{
  "name": "Meu Funil",
  "url": "https://meufunil.com",
  "connection_type": "script"
}
```

The response contains a one-time ingestion token. The token must be stored by the funnel owner and never committed to source control or exposed in client logs.

## Event ingestion

The canonical ingestion endpoint is the Supabase Edge Function:

`/functions/v1/funnel-events`

The funnel sends its ingestion token and a JSON event envelope. The event contract supports the platform event catalog already registered in `funnel_event_types` (for example: `page_view`, `quiz_started`, `quiz_answered`, `checkout_started`, `checkout_abandoned`, `payment_created`, `payment_approved`, `payment_failed`, `chat_started`, and `chat_message`).

A stable `external_id` should be supplied whenever the source system has one. Events must be safe to retry; the platform uses event keys/idempotency to prevent duplicate financial effects.

## White-label chat

The funnel may embed the isolated white-label chat widget and identify its product/brand in the widget configuration. ALTHEA branding must not be rendered inside a customer-facing funnel when the funnel belongs to another brand.

Chat events are persisted in `crm_conversations` and `crm_messages` and can be consumed by the private operator workspace.

## Data boundary

The funnel owns its pages, quiz presentation and checkout UX. ALTHEA owns orchestration, event ingestion, financial mirror records, routing state, CRM context, recovery state, auditability and operational analytics.

## Multi-funnel rule

There is no single-funnel assumption in the core. Every connection, event, checkout, chat, routing rule and operational record must carry its owning funnel identifier whenever the domain requires it. Adding a new funnel must not require a new deployment or a schema fork.

## Security

- Ingestion tokens are stored hashed.
- Customer-facing code must not receive gateway secrets.
- Gateway credentials belong to secure server-side storage/Vault-backed workflows.
- Operator data is protected by user-scoped RLS.
- Financial mutations must remain idempotent and auditable.
