# ALTHEA PAY — Architecture

ALTHEA PAY is a control-plane and intelligence layer for digital sales. It does **not** custody customer sales funds.

## Main flow

```text
Traffic / Funnel
      ↓
Event ingestion → idempotency → processing/retry
      ↓
Checkout session
      ↓
Gateway Orchestrator
      ├─ route by funnel/product/priority
      ├─ health guard
      └─ fallback for technical failures
      ↓
External gateway / Sandbox adapter
      ↓
Transaction projection → Sale projection
      ↓
Attribution + analytics + automations + realtime
```

## Gateway model
`gateway_routes` defines ordered routes by funnel/product. The orchestrator records every attempt in `gateway_operation_logs` and resulting state in `gateway_transactions`.

Technical failures may trigger fallback according to route configuration. A definitive customer/payment decline must not be blindly retried.

## Checkout model
`checkout_sessions` is the session aggregate. `checkout_items` represents products and future order-bump/upsell items. `checkout_offers` stores offer rules. `checkout_events` is the checkout event stream.

## Attribution
`attribution_sessions` stores source/medium/campaign/content/term and click identifiers so acquisition can be connected to funnel, checkout and sale events.

## Integrations
External funnel providers send signed events to the ingestion/webhook layer. Events are persisted in `integration_events`, keyed for idempotent processing, with retry/error metadata.

## Security boundaries
- Browser code never receives service-role credentials, gateway secrets, PAN or CVC.
- Business tables are protected by RLS.
- User-facing Edge Functions validate JWTs.
- Public webhook/ingestion functions use explicit signature/token/API-key validation.
- Internal workers use an internal secret and must not be made anonymous just to satisfy a scheduler.

## Reliability invariants
1. External events are deduplicated whenever an external ID/event key is available.
2. Payment commands use idempotency keys.
3. Technical failures may fallback; definitive declines do not silently cascade.
4. Webhooks use timestamp/replay protection and signature validation.
5. Retries are bounded and observable.
6. Disconnecting a funnel preserves historical ALTHEA data.

## Production blockers
`BLOQUEIO EXTERNO`: real gateway contracts/credentials, 3DS certification, PCI evidence, KYC/AML policy and production infrastructure credentials are outside source control and must be configured separately.
