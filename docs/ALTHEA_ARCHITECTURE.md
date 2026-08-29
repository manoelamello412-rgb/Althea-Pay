# ALTHEA — Architecture

## Product direction

ALTHEA is a control and intelligence platform for independently hosted sales funnels. It does **not** process or custody customer money. Payments remain with the gateway configured by each funnel. ALTHEA mirrors operational events, provides centralized visibility, chat, analytics, API access, and controlled configuration management.

## Core principles

1. **External payment ownership** — each funnel keeps its own gateway and checkout. ALTHEA never becomes the merchant-of-record or payment processor.
2. **Funnel independence** — funnels may live on their own domains and infrastructure.
3. **API-first** — integrations communicate through versioned APIs and signed webhooks.
4. **Event-driven** — payment, funnel, chat, and customer activity are normalized into events.
5. **Server-side secrets** — gateway credentials and provider secrets never live in browser storage.
6. **Least privilege** — authentication and authorization are enforced with Supabase Auth + PostgreSQL RLS and server-side checks.
7. **Auditability** — important changes and external events are immutable/auditable.
8. **Safe changes** — gateway/funnel configuration changes should be validated before activation and support rollback/version history where the external integration permits it.

## Target architecture

```text
Browser / ALTHEA Dashboard
          |
          v
     ALTHEA Web App
          |
          v
      ALTHEA API
          |
   +------+-------+----------------+
   |              |                |
   v              v                v
Postgres       Realtime       Edge Functions
   |                               |
   |                    +----------+----------+
   |                    |                     |
   v                    v                     v
Domain data       Gateway adapters       Funnel adapters
                  + webhook receivers    + event SDK/API
                         |
                         v
                 External providers
```

## Main domains

- Identity and organizations
- Funnels and funnel connections
- Products and offers
- Customers and leads
- Sales and payment mirrors
- Gateway connections
- Webhooks and normalized events
- Live chat and conversations
- Analytics and operational metrics
- API keys and integration credentials
- Audit logs
- Configuration versions / deployments
- AI tools and controlled actions

## Payment mirror model

ALTHEA stores a normalized representation of external payment state:

```text
Funnel -> External Gateway -> Payment
                     |
                  webhook
                     v
                  ALTHEA
                     |
        normalized payment + event
```

The authoritative financial transaction remains at the external gateway.

## Chat model

Each external funnel can embed/use an ALTHEA chat connector. A conversation is associated with the funnel, visitor/session, customer/lead when known, and assigned operator. Messages are stored centrally and delivered in real time to the ALTHEA dashboard.

## Integration model

Adapters should expose a normalized capability contract rather than coupling the core to one provider. A provider may support only a subset of capabilities.

Example capabilities:

- create payment
- query payment
- cancel/refund payment
- validate connection
- receive webhook
- verify webhook signature
- switch active configuration

The platform must check provider capabilities before presenting an action as available.

## Security model

- Supabase Auth for identity and session management.
- PostgreSQL RLS for tenant/resource isolation.
- Server-side Edge Functions for privileged operations and provider calls.
- Secrets stored in Supabase project secrets, never in `localStorage` or source code.
- Signed webhook verification for external providers.
- Idempotency keys for event/payment ingestion.
- Audit trail for administrative changes.
- Separate publishable client configuration from secret server credentials.

## Migration from the current prototype

The current repository contains a single `index.html` prototype whose persistence is based on browser `localStorage`. That implementation is retained as a visual/reference baseline for now. Production data and credentials must migrate to the server-backed architecture before the application is considered production-ready.
