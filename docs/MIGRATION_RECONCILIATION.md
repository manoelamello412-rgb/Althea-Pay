# Althea Pay — Migration Reconciliation

## Verified state

Audit date: 2026-09-17/18.

The live Supabase project and the GitHub repository do **not** share a reproducible migration history.

Verified counts at audit time:
- Live Supabase migration history: **561** rows in `supabase_migrations.schema_migrations`.
- GitHub audit branch: **329** SQL migration files after the audit hardening migrations.
- Comparing migration names before the final audit migration:
  - **284** remote migration names had no matching local migration file.
  - **51** local migration names had no matching remote history row.
- The final audit performance migration increases the local-only side by one until it is deliberately applied.

This drift is historical. It does **not** mean the current application schema is missing hundreds of runtime objects. During the audit, the active frontend/backend contracts were compared directly against the live Supabase schema and the canonical runtime objects were verified.

## Canonical current-schema contract

`types/supabase.ts` is generated from the **live Supabase project** and is committed as a snapshot of the current tables, views, functions and enums.

It is the current contract reference for application development. Regenerate it after reviewed schema changes.

It is **not** a replacement for migration history and must not be executed as SQL.

## Mandatory deployment rule

Do not run an automatic `supabase db push` against production from the historical migration folder.

Before any database deployment:

1. Run `supabase migration list --linked`.
2. Generate a current linked schema dump/baseline in a controlled maintenance task.
3. Compare the baseline with the repository's current schema contract and the proposed forward migrations.
4. Decide explicitly which old migration files are archive/history and which are part of the future canonical baseline.
5. Apply only reviewed **forward** migrations.
6. Verify Supabase Advisors and application E2E after the change.

The GitHub migration workflow intentionally audits history and forbids automatic `db push` while this reconciliation is open.

## Recommended baseline strategy

The safe long-term cleanup is:

1. Preserve the existing historical migration directory in an archival tag/branch.
2. Create a fresh canonical baseline from the live production schema using the Supabase CLI/pg_dump in a controlled environment.
3. Record the production migration-history reconciliation deliberately; do not fabricate old timestamps or mark unexecuted SQL as applied.
4. Keep only new forward migrations after that baseline in the active migration chain.
5. Test a clean database created from the new baseline plus forward migrations before changing the production workflow.

Do not attempt to reconstruct the 561-row production history by guessing SQL from object names.

## Audit migrations waiting for reviewed application

The audit branch contains forward migrations that are intentionally **not** auto-applied:

- `20260917203000_security_definer_access_hardening.sql`
- `20260917204000_crm_workers_pg_cron.sql`
- `20260917205000_gateway_rls_and_fk_performance_cleanup.sql`

They must be reviewed against the linked production schema immediately before application.

## Edge Functions are separate

Edge Function source has been reconciled independently from database migration history.

The GitHub repository now contains the canonical Edge Function inventory. Retired production-only stubs are intentionally absent and the main-branch function deployment uses `--prune` to remove them after merge.
