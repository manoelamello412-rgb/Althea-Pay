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
