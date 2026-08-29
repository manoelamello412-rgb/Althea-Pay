# ALTHEA PAY

ALTHEA PAY is a control center for independent sales funnels, external payment gateways, mirrored commerce events and live customer conversations.

## Product principles

- ALTHEA PAY does not custody customer funds.
- Payment processing remains with the gateway configured by each funnel/product.
- Funnels remain independently hosted and independently domain-bound.
- ALTHEA PAY receives trusted events through APIs/webhooks and mirrors operational data.
- Gateway credentials and other secrets stay server-side.
- Customer conversations from connected funnels can be centralized in the ALTHEA PAY inbox.
- Every sensitive operational change is auditable.

## Architecture

```text
Independent Funnel -> External Gateway
        |                   |
        | API/events        | signed webhooks/API
        +---------+---------+
                  v
             ALTHEA PAY API
                  |
        +---------+---------+
        |                   |
    Supabase             Realtime
        |                   |
        v                   v
  operational data     unified chat

ALTHEA PAY is the control/visibility layer; it is not the payment custodian.
```

## Naming

The product name is **ALTHEA PAY**. Use this spelling in UI copy, documentation, API-facing labels and product messaging.

## Development status

The repository is being migrated from the original browser prototype to a production-oriented application architecture. The legacy prototype is preserved while the real application layers are introduced incrementally.

## Environment

Create a local environment from `.env.example`. Never commit production secrets, gateway credentials, service-role keys or webhook secrets.
