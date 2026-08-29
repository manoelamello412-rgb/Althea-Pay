# ALTHEA — Integration Contract v1

## Purpose
ALTHEA is the control and intelligence layer above independently hosted funnels. A funnel keeps its own domain, pages, quiz and checkout. A payment provider keeps custody and processing of funds. ALTHEA receives authorized events, mirrors operational state and provides centralized control where the external system exposes a supported API.

## Canonical identifiers
Every integration should carry stable identifiers:

- `organization_id` — ALTHEA tenant/operation.
- `funnel_id` — ALTHEA funnel record.
- `external_funnel_id` — identifier in the external funnel system, when available.
- `gateway_connection_id` — configured gateway connector.
- `external_event_id` — provider event ID used for idempotency.
- `customer_id` — ALTHEA customer when identity is known.
- `external_customer_id` — provider/customer identifier when available.

## Event envelope
External integrations should send a normalized envelope:

```json
{
  "version": "1",
  "event_id": "provider-event-123",
  "event_type": "payment.approved",
  "occurred_at": "2026-08-29T18:00:00Z",
  "source": {
    "type": "gateway",
    "provider": "example",
    "account_id": "external-account-1"
  },
  "routing": {
    "organization_id": "org-123",
    "funnel_id": "fun-123",
    "gateway_connection_id": "gw-123"
  },
  "data": {}
}
```

## Event rules
1. Validate the provider signature before parsing sensitive business data.
2. Reject events with an invalid signature.
3. Use `event_id` plus source/provider scope for idempotency.
4. Persist the raw event metadata needed for audit/reconciliation, without storing unnecessary secrets.
5. Normalize the event into ALTHEA's domain model.
6. Return success only after the event is durably accepted.
7. Processing must be safe to retry.

## Payment mirror
ALTHEA does not become the payment processor. `payment.approved`, `payment.pending`, `payment.failed`, `payment.refunded`, `chargeback.created` and similar provider events update the mirror. The source of truth for money movement remains the external gateway.

## Funnel client
A future ALTHEA browser SDK or signed API integration may send:

- visitor/session started;
- quiz answer submitted;
- offer viewed;
- checkout opened;
- chat started;
- chat message sent;
- purchase intent.

The client must never receive gateway secret material. Public identifiers and short-lived signed credentials are acceptable; privileged gateway operations remain server-side.

## Live gateway switching
A gateway switch is a control-plane operation, not a payment transfer. Before activation ALTHEA must validate:

- connector is configured;
- required server-side secret exists;
- connector health check succeeds;
- funnel/product compatibility is satisfied;
- webhook destination is configured;
- environment is correct (test/production);
- previous routing target is recorded for rollback.

The operation must create an audit record. If the external funnel cannot change its gateway through a supported API, ALTHEA must report that limitation rather than pretending the switch succeeded.

## Chat
Funnel chat is independent of WhatsApp. A funnel can embed an ALTHEA chat client and send messages through the integration contract. Operators use one private real-time inbox. Conversations remain associated with organization, funnel and customer context.

## Security boundary
- Browser: public configuration only.
- ALTHEA API: authenticated operator actions and RLS-scoped reads.
- Integration webhooks: provider signature/API-secret validation and idempotency.
- Secret management: server-side only.
- Audit: every infrastructure/payment-routing change.

## Versioning
Breaking changes require a new contract version. Event consumers must ignore unknown fields and safely reject unsupported major versions.
