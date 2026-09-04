# Frontend operational consolidation

This branch closes the frontend consolidation against `main` while preserving the production financial shell.

## Global shell
- `app/layout.tsx`: global Next.js layout, metadata, design-system styles and session actions.
- Responsive/mobile navigation and dashboard period UI remain wired through the existing shared styles/components.

## Five operational areas
1. Dashboard — financial KPIs, period filtering, transactions, metric details and reactive Supabase data.
2. Vendas — transaction list, search, filters, sale detail/audit sheet and operational actions.
3. Gateways — infrastructure health, routing controls, gateway state and operational diagnostics.
4. Funis & Chat — funnel operations, omnichannel conversations, contextual CRM and realtime messages.
5. Configurações — account, financial, checkout, integration, notification and security controls.

## Data integrity
The frontend reads tenant-scoped Supabase data and keeps the existing realtime, idempotency and protected-route behavior. No fake customer or financial records are introduced by this consolidation.

## Validation
CI is authoritative for `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, load smoke and release preflight. The draft PR is opened against `main` so those checks execute on the consolidated head.
