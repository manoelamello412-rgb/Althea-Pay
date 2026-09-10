# ALTHEA PAY — Multi-CRM Structural Audit

Date: 2026-09-10

## Canonical architecture

The Multi-CRM uses the existing canonical surfaces only. No duplicate conversation/message architecture was introduced.

- `crm_conversations` — canonical conversation aggregate
- `crm_messages` — canonical message history
- `crm_webhook_events` — event ingestion/audit
- `crm_channel_accounts` / `crm_channel_identities` — omnichannel boundary
- `crm_channel_message_outbox` — durable outbound delivery
- `crm_agents` — operator identity/availability
- `crm_conversation_notes` — internal notes
- `crm_conversation_tags` — conversation tagging
- existing automation, predictive, recovery, experiment and SLA functions
- `gateway_payment_link_execution_commands` — durable commercial execution boundary

## Final operational axes added

Migration: `20260910190000_crm_final_operational_axes_v1.sql`

- Teams: `crm_teams`
- Team membership: `crm_team_members`
- Tag catalog: `crm_tags`
- Quick replies: `crm_quick_replies`
- Tasks/follow-ups: `crm_tasks`
- Segments: `crm_segments`
- Conversation assignment RPC: `crm_assign_conversation`
- Task completion RPC: `crm_complete_task`
- RLS enabled on every new table
- authenticated RPC execution restricted to tenant owner

## Security invariants

All new tables are tenant-scoped through `user_id` and have owner RLS. Assignment validates conversation, agent and team ownership before mutation. No browser-supplied tenant identifier is trusted as an authorization boundary.

## External connections intentionally not required

The structural CRM can be completed and tested without connecting WhatsApp, external channel providers, payment gateways or suppliers. Those integrations remain adapter boundaries.

## Payment-link execution boundary

The payment-link queue is present and idempotent. Its worker/external provider execution is deliberately kept behind the existing canonical gateway provider adapter. No fake payment, fake credential, or simulated successful financial state is introduced.

## Validation performed

Supabase production project was inspected after the migration:

- all final CRM operational tables exist;
- RLS is enabled on the new tables and canonical CRM channel tables inspected;
- assignment/task RPCs are executable by authenticated users only;
- payment-link queue claim/complete/fail functions remain service-role-only;
- existing CRM automation, omnichannel, predictive, SLA, recovery and experiment surfaces are present.

## Remaining integration-dependent validation

Live provider execution cannot be validated until a real production gateway credential is intentionally connected. This is an integration test boundary, not a reason to fabricate a successful payment or payment URL.
