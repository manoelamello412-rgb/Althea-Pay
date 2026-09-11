# ALTHEA PAY — Frontend Global Audit

This document records the execution scope for the frontend recovery pass. It is intentionally implementation-oriented: every finding must be traced from domain capability to route, component, action, and real data before changes are made.

## Required matrix

| Domain | Backend/API/RPC | Route/component | Visible capability | Real action/data | Gap |
|---|---|---|---|---|---|
| Dashboard | audit | audit | audit | audit | pending |
| Sales | audit | audit | audit | audit | pending |
| Checkout | audit | audit | audit | audit | pending |
| Products | audit | audit | audit | audit | pending |
| Funnels | audit | audit | audit | audit | pending |
| Customers | audit | audit | audit | audit | pending |
| CRM / Multi-CRM | audit | audit | audit | audit | pending |
| Conversations / Chat | audit | audit | audit | audit | pending |
| Gateways | audit | audit | audit | audit | pending |
| Payment Engine | audit | audit | audit | audit | pending |
| Transactions | audit | audit | audit | audit | pending |
| Webhooks | audit | audit | audit | audit | pending |
| Reconciliation | audit | audit | audit | audit | pending |
| Affiliates | audit | audit | audit | audit | pending |
| Metrics / Analytics | audit | audit | audit | audit | pending |
| AI | audit | audit | audit | audit | pending |
| Settings / Admin | audit | audit | audit | audit | pending |
| Authentication / Authorization | audit | audit | audit | audit | pending |
| Integrations | audit | audit | audit | audit | pending |

## UI failure classes

- Layout width/height distortion
- CSS cascade conflict
- Missing domain capability in UI
- UI action not connected to real operation
- Real data not rendered
- Incorrect empty/loading/error state
- Realtime capability not surfaced
- Responsive/mobile composition issue
- Duplicate presentation implementation
- Business logic incorrectly embedded in presentation
- Mock/fabricated production data

## Safety rule

No deletion or migration is justified by naming alone. Before removing a style, component, API, RPC, table, migration, or domain implementation, identify consumers and dependency direction and preserve the most complete functioning source of truth.
