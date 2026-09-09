# ALTHEA PAY — Chat CRM Elite Status

## Benchmark target

The CRM is designed to compete with payment-native CRM patterns used by Appmax and recovery/checkout automation patterns used by Hotmart, without treating any competitor as an architectural ceiling.

## Operational principles

- Database is the source of truth.
- No mock customers, sales, messages, payments or recovery opportunities.
- Conversation, funnel, checkout, transaction and payment context remain linked by real identifiers.
- Operator message mutations are idempotent and protected by PostgreSQL transactional locks.
- Recovery execution is idempotent and serialized in PostgreSQL.
- Supabase Realtime drives operational updates without requiring page refresh.
- Recovery opportunities are scored from real webhook events and are removed from the queue only after an atomic recovery execution.
- Analytics and TMR are computed from persisted operational data; no fabricated fallback values are permitted.

## Recovery Intelligence

The recovery layer currently supports:

1. Real failed/declined/pending/abandoned opportunity detection.
2. Priority scoring based on event state, opportunity value, customer identification and recency.
3. Recommended next action per opportunity.
4. Atomic assignment to an available operator using row locking and advisory locking.
5. Conversation creation/reuse and recovery audit metadata.
6. Direct handoff from recovery queue to the Chat CRM.
7. Recovery execution API with authenticated tenant ownership checks.

## Customer 360

Customer 360 is backed by a tenant-scoped PostgreSQL RPC and correlates real conversations, sales, checkout sessions, gateway payment attempts and webhook events using available customer email, customer ID and transaction identifiers. The message window is explicitly capped before JSON aggregation to prevent unbounded historical message aggregation.

## Quality bar

The CRM is not considered complete when it merely renders a dashboard. It must preserve the invariant:

> If an operational event happened, the CRM must represent it accurately; if it did not happen, the CRM must not invent it.

## Current implementation surface

- `app/dashboard/crm/page.tsx`
- `app/dashboard/crm/customer-360/page.tsx`
- `app/api/crm/customer-360/route.ts`
- `app/dashboard/crm/recovery/page.tsx`
- `app/api/crm/recovery/route.ts`
- `app/api/crm/recovery/opportunities/route.ts`
- `app/api/crm/analytics/route.ts`
- `supabase` RPCs for Customer 360, atomic operator mutations, recovery execution, analytics and recovery opportunities
- `supabase/migrations/20260909194702_crm_atomic_operator_mutations.sql`
- `supabase/migrations/20260909195128_crm_recovery_atomic_analytics_v2.sql`
- `supabase` migration `crm_customer_360_message_window_cap_v2`
