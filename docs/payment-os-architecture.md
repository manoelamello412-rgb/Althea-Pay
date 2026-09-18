# ALTHEA PAY — Payment OS Architecture

## Architectural position

ALTHEA PAY is a provider-agnostic payment operating layer. A funnel is a first-class business object and owns the customer-facing payment experience; gateways/PSPs are replaceable infrastructure adapters behind a routing core.

The design takes four complementary references without cloning any one product:

- **Payment OS/core:** lifecycle ownership, ledger-oriented transaction model, provider drivers and operational control.
- **Orchestration:** one canonical payment contract, routing rules, retries, fallback, observability and provider independence.
- **Gateway abstraction:** provider registry, capability matrix, per-flow routing and failover.
- **ALTHEA product layer:** funnels, checkout configuration, offers/products, customer context, operations, CRM and analytics.

## Runtime flow

```text
Funnel
  -> Checkout
  -> Payment Intent
  -> Published Payment Flow
  -> Deterministic Routing Engine
  -> Provider Adapter
  -> Gateway / PSP
  -> Webhook / reconciliation
  -> Payment Attempt
  -> Payment Intent state
  -> Sales / CRM / analytics
```

## Core invariants

1. **No provider is hard-coded into the payment domain.** Gateway-specific behavior lives behind `PaymentProviderAdapter`.
2. **The funnel is first-class.** A payment intent always carries the funnel that originated the transaction.
3. **Published flows are versioned.** A payment attempt records the selected flow version and step, making routing auditable.
4. **Routing is deterministic.** Conditions are evaluated in step order; a defined fallback is selected when no condition matches.
5. **Ambiguous provider outcomes must not be blindly retried.** The transaction is parked for reconciliation when the provider result cannot prove whether money moved.
6. **Idempotency is persistent.** The idempotency key is unique per organization and is represented in the database, not in process memory.
7. **Locks are always released.** Mutation execution uses `try/catch/finally` so provider failures cannot leave an orphaned application-level lease.
8. **Unique conflicts use bounded exponential backoff.** PostgreSQL `23505` is explicitly recognized as retryable by the shared retry policy.
9. **Provider credentials remain server-side.** UI payloads expose only safe configuration; secrets are referenced rather than returned.

## Database model

The migration `0009_payment_os_orchestration.sql` adds:

- `payment_flows`
- `payment_flow_versions`
- `payment_flow_steps`
- `payment_intents`
- `payment_attempts`
- `payment_idempotency_locks`

Existing `funnels` and `gateway_connections` remain the business and provider boundaries. This avoids replacing the current core and instead adds the missing orchestration layer around it.

## Routing example

A funnel can publish a flow such as:

```text
Credit card
  1. amount >= 500 -> Provider A
  2. fallback       -> Provider B

Pix
  1. default        -> Provider C

Boleto
  1. default        -> Provider D
```

The checkout does not know which provider is selected. It sends the canonical payment request to ALTHEA PAY. The routing engine resolves the provider and the provider registry resolves the adapter.

## Provider abstraction

Adding a new gateway should require a new adapter and a capability declaration, not changes to funnels, checkout contracts, sales records or the routing engine.

The canonical contract is:

```ts
PaymentProviderAdapter.createPayment(request, connection)
```

The domain only understands `PaymentProviderAdapter`, `PaymentRequest`, `PaymentFlow` and `ProviderPaymentResult`.

## Operational model

The payment lifecycle is intentionally separated into intent and attempts:

```text
PaymentIntent
  ├── Attempt #1 -> Provider A -> timeout -> unknown
  ├── reconciliation
  └── Attempt #2 -> Provider B -> paid
```

This prevents the classic failure mode where a timeout is treated as a safe decline and a second gateway is charged while the first provider may already have authorized the transaction.

## Next implementation layer

The next layer should bind these contracts to the existing Supabase persistence and expose authenticated server routes for:

- creating and publishing funnel payment flows;
- registering gateway connections and capabilities;
- creating idempotent payment intents;
- resolving and executing routing;
- receiving signed provider webhooks;
- reconciliation of ambiguous attempts;
- realtime operational status;
- checkout consumption of the provider-agnostic payment contract.

No checkout or funnel should ever receive a provider-specific credential or depend on a provider-specific response shape.
