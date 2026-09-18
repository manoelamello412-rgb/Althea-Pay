# Revenue Sources & Integration Onboarding

## Purpose

`revenue_sources` is the catalog layer above the operational domains that already exist in Althea Pay. It does not replace funnels, gateways, payments, webhooks, checkout sessions, CRM, or integration events.

The source catalog gives the Control Plane one stable abstraction for revenue-producing origins while preserving each domain as its own source of truth.

Supported catalog types:

- `funnel`
- `direct_checkout`
- `payment_link`
- `subscription`
- `affiliate`
- `marketplace`
- `store`
- `manual_sale`
- `external_api`
- `custom`

Only **external funnel** is currently exposed as connectable in the UI because it has an operational end-to-end runtime. Other types remain catalog contracts until their adapters exist.

## Funnel synchronization

Funnels remain canonical in `public.funnels`.

Database triggers keep one `revenue_sources` row synchronized with each funnel:

- insert creates/upserts the catalog entry;
- rename/status/type updates refresh the catalog entry;
- soft delete maps the source to `archived`;
- hard delete archives the source instead of leaving an orphan.

The uniqueness rule is `organization_id + source_type + source_ref_id` for referenced sources.

## Connection-first onboarding

A funnel can be created without a product or gateway.

The canonical provisioning transaction creates:

1. the funnel identity;
2. the funnel connection;
3. an ingestion credential;
4. the seeded journey structure;
5. optional product offer, when supplied;
6. optional gateway binding, when supplied.

Product and gateway are therefore commercial enrichments, not prerequisites for connecting an external source.

The same `FunnelCreateWorkspace` is used by:

- `/dashboard/funil/novo`;
- `/dashboard/integration-hub/connect`.

This avoids two provisioning implementations.

## Operational progress

`integration_hub_overview_v1` derives onboarding progress from persisted runtime state.

Required milestones:

1. Revenue Source registered.
2. Funnel connection exists.
3. Ingestion credential or active webhook exists.
4. First event has been received.

Product, gateway and remote-control readiness are shown as optional capabilities.

The Hub never marks a source operational based only on local registration. A source becomes operational after real event activity exists and no connection-health error is present.

## Credential boundary

The long-lived ingestion token is a one-time operator secret. It must be stored on a backend or secret manager and must not be embedded into browser JavaScript.

Browser integrations use:

- the public connector SDK;
- the short-lived client-token endpoint;
- short-lived browser credentials.

The UI exposes these endpoints in the one-time provisioning handoff but never persists the long-lived plaintext token.

## Security

- `revenue_sources` has RLS enabled.
- Reads require organization membership.
- Writes require an allowed organization role.
- Anonymous table access is revoked.
- `integration_hub_overview_v1` requires an authenticated user and a valid default organization membership.
- The overview returns operational metadata only; it does not return credential hashes, webhook secrets, API key hashes, provider credentials, or raw secret material.
