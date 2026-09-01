# DB-backed scaffolding added

This commit adds DB-backed scaffolding (migrations and runtime DB helpers) that allow the project to persist idempotency keys, webhook events, and a POC ledger for reconciliation.

Files added/updated:
- supabase/migrations/0001_init.sql (tables: idempotency_keys, webhook_events, dlq, ledger_transactions, reconciliations)
- lib/db.ts (pg client wrapper using DATABASE_URL)
- lib/idempotency.ts (updated to use DB when available; keeps memory fallback)
- supabase/functions/integration-webhook (now persists into webhook_events if DB present)
- supabase/functions/event-worker (now queries webhook_events and processes rows with retries + DLQ)

How to enable DB-backed behavior
1. Add DATABASE_URL as a GitHub Secret or env var locally.
2. Apply migrations against the DB: `psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql` or use Supabase CLI.
3. Ensure your CI has DATABASE_URL set to run DB-backed E2E tests.

Notes
- This code will gracefully fallback to in-memory behavior if DATABASE_URL is absent, but persistence, worker processing, and reconciliation require a Postgres DB.
- Do NOT commit DATABASE_URL or other secrets. Use GitHub Actions Secrets or a secret manager.
