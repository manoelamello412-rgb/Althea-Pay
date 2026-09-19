# Organization access model

Althea Pay treats an account as an organization with multiple internal users. End customers never receive access to this organization model.

## Roles

Canonical roles remain:

- owner
- admin
- manager
- operator
- supervisor
- viewer

Roles provide conservative defaults. Per-member capability overrides can narrow or expand non-owner access without creating ad-hoc roles.

## Capabilities

The backend capability contract is:

- can_view_chats
- can_reply_chats
- can_view_values
- can_manage_gateways
- can_change_funnel_gateway
- can_view_customers
- can_manage_members
- can_view_audit
- can_manage_funnels
- can_manage_products
- can_manage_automations
- can_manage_integrations

Owners always have all capabilities. Admins cannot modify their own capability overrides, another admin's overrides, or an owner's capabilities. Owners cannot modify their own capabilities either.

## Visibility window

Operational visibility is separate from data retention.

- owner/admin: 2160 hours (90 days)
- manager/operator/supervisor/viewer: 48 hours

This is an authorization window only. It does not delete historical, financial, compliance, or audit data.

## Frontend contract

The frontend should read the current user's effective access through:

`organization_my_access_v1(organization_id?)`

The response contains:

- organization_id
- user_id
- role
- capabilities
- operational_history_hours
- retention_policy

The frontend may hide or disable actions based on this contract, but backend authorization remains authoritative.

## Rollout rule

This migration is additive. It does not yet rewrite legacy user-scoped CRM/payment policies. Those paths must be migrated in controlled stages to organization scope plus capabilities before multi-user access is enabled in the UI.


## CRM organization-scope migration

Core CRM tables now carry a canonical `organization_id` in addition to the legacy `user_id` owner attribution. Existing rows are backfilled from the owner's default organization, and future rows are guarded against cross-organization mismatches.

This stage is intentionally additive: legacy CRM RLS policies and operator RPCs still use owner-scoped `user_id` checks until the next authorization stage replaces those checks with organization membership, capabilities, and operational history windows.


## CRM capability authorization

The core CRM authorization layer now uses the current member's organization, granular capabilities, and the operational history window.

Read access:
- conversations/messages require `can_view_chats`
- financial webhook-event visibility requires `can_view_values`
- owner/admin operational history: 90 days
- non-admin internal roles: 48 hours

Core operator mutations:
- mark read
- change conversation status
- assign conversation/team/priority
- send message

require `can_reply_chats`.

During the staged migration, `user_id` remains the legacy operation-owner attribution so existing external routing and idempotency contracts keep working. The actual internal operator who sends a message is recorded separately via `sender_id` and `actor_id` metadata.

The public page/access RPCs that call private authorization helpers are `SECURITY DEFINER` with explicit search paths and authenticated-only EXECUTE grants. This avoids exposing the `private` schema to browser roles.


### Non-owner CRM read boundary

Non-owner members do not receive direct table-level SELECT access to conversation/message rows. Their operational CRM reads go through capability-aware RPCs.

The RPC layer:
- enforces the member's current organization and visibility window;
- requires `can_view_chats`;
- removes `public_token`;
- redacts monetary keys from metadata when `can_view_values=false`;
- redacts customer-identifying metadata when `can_view_customers=false`;
- hides gateway error details unless `can_manage_gateways=true`.

This prevents a hidden UI field from becoming a backend data leak. Owner-attributed direct reads remain temporarily available for the existing owner frontend while Codex migrates the browser queries to the organization-aware contracts.
