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
- The historical drift remains, but the new audit migrations created after this review are now mirrored locally using the exact versions recorded by the linked Supabase project.

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

## Audit forward migrations applied and reconciled

During the live audit, the relevant changes were revalidated against the linked production schema and then applied through Supabase's migration API. The repository now records the **actual remote migration versions**:

- `20260918020651_audit_harden_rpc_acl_and_commercial_view.sql`
- `20260918021208_fix_funnel_gateway_binding_tenant_policy.sql`
- `20260918021448_schedule_canonical_crm_workers.sql`
- `20260918021452_consolidate_gateway_read_policies_and_indexes.sql`
- `20260918021456_restrict_checkout_status_rpc_to_server.sql`

The earlier local-only audit drafts dated `20260917203000`, `20260917204000` and `20260917205000` were never present in the linked migration history. After their intended changes were reviewed, applied under the real remote versions above, and verified, those unapplied drafts were removed from the active branch to avoid future duplicate execution. Their history remains available in Git.

This does **not** resolve the older historical migration drift. Automatic `supabase db push` remains forbidden until a canonical production baseline is deliberately created.

## Edge Functions are separate

Edge Function source has been reconciled independently from database migration history.

The GitHub repository now contains the canonical Edge Function inventory. Retired production-only stubs are intentionally absent and the main-branch function deployment uses `--prune` to remove them after merge.
