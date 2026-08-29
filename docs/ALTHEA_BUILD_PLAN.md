# ALTHEA — Build Plan

## Product direction
ALTHEA is a control and intelligence layer for independently hosted funnels. It does not process or hold customer payment funds. External gateways remain the payment processor; ALTHEA mirrors events, analytics, customer context and operational state through APIs/webhooks.

## Current foundation
- Supabase Auth for operator identity.
- PostgreSQL with organization-scoped RLS.
- Funnel, product, gateway connection, customer, lead, sale, integration event, chat and audit models.
- Edge Functions for authenticated APIs and external webhooks.
- Gateway connections are represented separately from funnels so a funnel can switch its active connector without moving funds through ALTHEA.

## Build sequence
1. Core authentication and first-organization bootstrap.
2. Role/capability authorization and audit trail.
3. Real dashboard replacing localStorage-backed operational data.
4. Funnel and product management.
5. Gateway connector framework and webhook ingestion.
6. Sales/event mirror with idempotency and reconciliation.
7. Embedded funnel chat and private real-time operator inbox.
8. Analytics/event timeline and funnel health monitoring.
9. Safe live configuration changes with validation, deployment checks and rollback.
10. AI operations layer with read-only analysis first, then explicitly authorized actions.
11. Public API, connector SDK and versioned integration contracts.

## Non-negotiable security rules
- Gateway secrets never live in browser localStorage or frontend source.
- External webhook endpoints do not trust a user JWT; they validate the provider signature/API secret and enforce idempotency.
- Every organization-owned table is protected by RLS.
- Operator actions that alter infrastructure or payment routing are audited.
- AI actions are least-privilege and require explicit authorization for destructive or high-impact operations.

## Chat model
Each conversation belongs to an organization and may be linked to a funnel and customer. The funnel remains independently hosted. A future lightweight ALTHEA client/SDK or signed API integration will send visitor events and messages to ALTHEA. Operators answer from one centralized inbox. Realtime channels must be private and authorized.

## Gateway model
A gateway connection stores only non-secret configuration in the database. Secret material is referenced through server-side secret management. A funnel may have many configured gateways but only one active routing target at a time. Switching must run compatibility checks and produce an audit event before activation.
