# ALTHEA PAY — Architecture

ALTHEA PAY is a control-plane and intelligence layer for digital sales. It does not custody customer sales funds.

## Main flow

Funnel → Integration Event → Checkout → Gateway Orchestrator → External Gateway → Signed Webhook → Transaction Ledger → Realtime → Dashboard/Analytics/Automation

## Gateway model

`gateway_routes` defines ordered routes by funnel/product. The orchestrator records every attempt in `gateway_operation_logs` and the resulting state in `gateway_transactions`.

Technical failures may trigger fallback according to route configuration. A definitive customer decline must not be blindly retried.

## Checkout model

`checkout_sessions` is the session aggregate. `checkout_items` represents main products and future order-bump/upsell items. `checkout_offers` stores offer rules. `checkout_events` is the event stream for the checkout.

## Attribution

`attribution_sessions` stores source/medium/campaign/content/term and click identifiers so the platform can connect acquisition to funnel and checkout events.

## Integrations

External funnel providers send signed events to the webhook layer. Events are persisted in `integration_events`, keyed for idempotent processing, with retry/error metadata.

## Security

All exposed business tables use RLS. User-facing Edge Functions validate the caller's JWT. External webhook functions must validate provider signatures in the handler. Secrets and service-role credentials must remain server-side.

## Realtime

Operational state should be broadcast through authenticated/private channels as the platform grows, with RLS authorization on realtime topics.
