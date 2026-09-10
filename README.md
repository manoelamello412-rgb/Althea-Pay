# ALTHEA PAY

ALTHEA PAY is the operational control center for independent sales funnels, external payment gateways, commerce events, customer conversations and AI-driven operations.

## IARA

**IARA is the native operational intelligence of ALTHEA PAY.** Its target architecture is an authorized agentic operating layer that understands the complete commercial lifecycle — traffic, funnels, products, checkouts, payments, gateways, customers, CRM, affiliates, revenue and operational metrics — and can analyze, plan, execute, verify and monitor authorized operations.

The engineering target is global leadership across the combined capabilities of payment intelligence, autonomous finance operations, enterprise agents, CRM intelligence and agentic commerce. The benchmark set includes Stripe, Ramp, Salesforce Agentforce and PayPal, but IARA is designed as a vertical intelligence layer for the ALTHEA PAY operating model rather than a clone of any competitor.

### Core invariant

> **Autonomia máxima na operação. Autonomia zero sobre código e infraestrutura.**

IARA can operate only within the authenticated user's existing authorization. Backend policy, RBAC/ABAC, resource scope and audit controls are mandatory; the model itself never grants permission.

### Agentic execution loop

```text
UNDERSTAND -> ANALYZE -> PLAN -> AUTHORIZE -> EXECUTE -> VERIFY -> EXPLAIN -> MONITOR
```

No operation is reported as completed until the authoritative result has been verified.

### Specialist capabilities

The architecture supports typed specialist agents for Sales, Payments, Gateways, Funnels, Checkouts, CRM, Affiliates, Analytics, Risk, Finance and External Research, coordinated by a central IARA orchestrator.

### Business graph

```text
Traffic
  -> Funnel
  -> Product / Offer
  -> Checkout
  -> Payment
  -> Gateway
  -> Customer
  -> CRM / Conversation
  -> Affiliate
  -> Revenue
  -> Analytics / Forecast / Action
```

## Security and data architecture

- ALTHEA PAY does not custody customer funds; payment processing remains with the configured external gateway.
- PostgreSQL/Supabase is the authoritative transactional datastore.
- Redis, where introduced, is limited to coordination, cache and rate-limiting roles; it is never the source of truth.
- Sensitive data protection uses authenticated encryption and context-bound key derivation where required.
- Tenant isolation is enforced through backend authorization and database policies, with cryptographic separation for protected payloads where appropriate.
- Every state-changing operation must be idempotent, auditable and verifiable.
- Production secrets, service-role keys and webhook credentials never enter source control.

## Architecture

```text
Independent Funnels / Gateways
              |
              v
        Webhook / API ingress
              |
       Authentication + Policy
              |
       Normalization / Events
              |
       +------+-------+--------+
       |              |        |
    Supabase         IARA    Realtime
       |              |        |
       |        Tools / Memory |
       |              |        |
       +--------------+--------+
                      |
                Dashboard / CRM
```

The production direction remains **Next.js/Vercel + Supabase + Edge Functions + dedicated AI Engine + Supabase Realtime**. New IARA capabilities extend this architecture instead of introducing a competing monolithic backend.

## IARA governance

The complete engineering doctrine is maintained in [`docs/IARA_GLOBAL_LEADERSHIP_ARCHITECTURE.md`](docs/IARA_GLOBAL_LEADERSHIP_ARCHITECTURE.md).

The governance document defines the agent architecture, specialist boundaries, memory, tools, authorization, risk-based autonomy, observability, proactive intelligence, agentic commerce and non-negotiable security constraints.

## Product principles

- Funnels remain independently hosted and independently domain-bound.
- ALTHEA PAY receives trusted events through APIs/webhooks and mirrors operational data.
- Gateway credentials and other secrets stay server-side.
- Customer conversations from connected funnels can be centralized in the ALTHEA PAY inbox.
- Every sensitive operational change is auditable.
- IARA never modifies application code or infrastructure.

## Naming

The product name is **ALTHEA PAY**. Use this spelling in UI copy, documentation, API-facing labels and product messaging.

## Visual identity

The approved frontend identity uses the official two-leaf ALTHEA PAY mark, Space Grotesk typography, and the dark premium palette: #0B0B0D, #0F1A16, #0D362D, #1DB854, #D4AF37 and #A6A6A6. The approved tagline is **CONSTRUA SUAS RAÍZES FINANCEIRAS.**

## Environment

Create a local environment from `.env.example`. Never commit production secrets, gateway credentials, service-role keys or webhook secrets.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```
