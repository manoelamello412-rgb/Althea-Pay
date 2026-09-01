# ALTHEA PAY — Production Readiness

## Core implemented
- Supabase Auth + RLS
- Multi-funnel data model
- Multi-product data model
- Gateway routes and transaction ledger
- Checkout sessions/items/offers/events
- Attribution sessions
- Integration events with idempotency fields
- Automation rules
- Gateway Sandbox
- Gateway Orchestrator
- Checkout Engine
- External webhook functions
- Audit/log foundation
- Organization and role foundation

## Remaining launch actions

### User-owned / external configuration
- Configure the production domain and DNS.
- Configure a production SMTP provider and branded email templates.
- Enable leaked-password protection in Supabase Auth.
- Enable/verify MFA for the owner's Supabase account.
- Review Supabase plan, backups/PITR and production capacity.
- Configure any real gateway credentials and webhook signing secrets.
- Configure Meta/Google/TikTok tracking credentials if required.
- Perform real payment certification with the chosen gateway.

### Final technical verification
- Run end-to-end checkout tests in Sandbox.
- Verify webhook signature validation for each real provider.
- Verify gateway fallback behavior with simulated technical failures.
- Verify realtime events from checkout and transaction updates.
- Verify role and funnel-access isolation with multiple test users.
- Load-test critical endpoints before a large launch.
- Confirm production deployment and custom-domain HTTPS.

## Security principles
- Never place Supabase secret/service-role keys in browser code.
- Keep user-called Edge Functions authenticated.
- Keep external webhook functions unauthenticated at the platform layer only when the handler validates the provider signature.
- Use RLS for tenant isolation.
- Keep financial settlement in external gateways; ALTHEA is the control and intelligence layer.
