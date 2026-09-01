# ALTHEA PAY — Test Strategy

Before production, validate authentication, RLS isolation, checkout idempotency, gateway routing/fallback, webhook signature/replay protection, funnel connection health, chat realtime, API-key scopes/revocation, and abandoned-checkout recovery.

The repository also contains the Supabase production function configuration under `supabase/config.toml`.
