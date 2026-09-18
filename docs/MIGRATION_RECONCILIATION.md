# Althea Pay — Migration Reconciliation

## Verified state

Audit date: 2026-09-17/18.

The live Supabase project and the GitHub repository do **not** share a reproducible migration history.

Verified counts at audit time:
- Live Supabase migration history: **589** rows in `supabase_migrations.schema_migrations`.
- GitHub audit branch: **356** SQL migration files after the audit hardening migrations.
- Comparing migration names before the final audit migration:
  - **282** remote migration names had no matching local migration file.
  - **49** local migration names had no matching remote history row.
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

Do not attempt to reconstruct the 589-row production history by guessing SQL from object names.

## Audit forward migrations applied and reconciled

During the live audit, the relevant changes were revalidated against the linked production schema and then applied through Supabase's migration API. The repository now records the **actual remote migration versions**:

- `20260918020651_audit_harden_rpc_acl_and_commercial_view.sql`
- `20260918021208_fix_funnel_gateway_binding_tenant_policy.sql`
- `20260918021448_schedule_canonical_crm_workers.sql`
- `20260918021452_consolidate_gateway_read_policies_and_indexes.sql`
- `20260918021456_restrict_checkout_status_rpc_to_server.sql`
- `20260918024711_restrict_checkout_status_rpc_to_service_role.sql`
- `20260918025009_remove_deprecated_checkout_status_role_guard.sql`
- `20260918030253_gateway_global_primary_switch_v1.sql`

The earlier local-only audit drafts dated `20260917203000`, `20260917204000` and `20260917205000` were never present in the linked migration history. After their intended changes were reviewed, applied under the real remote versions above, and verified, those unapplied drafts were removed from the active branch to avoid future duplicate execution. Their history remains available in Git.

This does **not** resolve the older historical migration drift. Automatic `supabase db push` remains forbidden until a canonical production baseline is deliberately created.

## Edge Functions are separate

Edge Function source has been reconciled independently from database migration history.

The GitHub repository now contains the canonical Edge Function inventory. Retired production-only stubs are intentionally absent and the main-branch function deployment uses `--prune` to remove them after merge.

## Continuation on 2026-09-18

Applied and verified forward migrations, mirrored using actual remote versions:

- `20260918034336_canonical_gateway_runtime_ranking.sql`
- `20260918034600_remove_ambiguous_gateway_ranking_overload.sql`

The earlier local draft timestamps for these two repairs were replaced with the
actual remote versions; the SQL remains in Git history. Historical drift remains
open. See `AUDIT_CONTINUATION_2026-09-18.md` for evidence and remaining blockers.


## Funnel remote-control continuation on 2026-09-18

The following reviewed forward migrations were applied to the linked Supabase project and mirrored in GitHub using the exact remote versions:

- `20260918040711_funnel_remote_command_control_plane_v1.sql`
- `20260918041340_funnel_remote_command_two_phase_v2.sql`
- `20260918042319_funnel_command_immediate_batch_claim_and_legacy_lockdown_v3.sql`
- `20260918042556_schedule_funnel_command_worker_v4.sql`
- `20260918043540_funnel_gateway_rollback_and_drift_foundation_v5.sql`
- `20260918043924_schedule_funnel_drift_worker_v6.sql`
- `20260918044600_funnel_control_tenant_integrity_v7.sql`
- `20260918050052_fix_funnel_worker_runtime_auth_v8.sql`
- `20260918050607_grant_funnel_control_service_acl_v9.sql`

These migrations add the durable external-funnel command plane, two-phase verified gateway switching, service-only lockdown of the former local-only global switch, retry and drift workers, rollback state, RLS-protected drift records, and database-level tenant-integrity enforcement.

Current reconciled counts at this continuation checkpoint:
- Live migration history: **589**
- Local SQL migration files: **356**
- Remote logical names without a local name match: **282**
- Local logical names without a remote name match: **49**

Historical drift remains open. These updated counts do not make the old migration chain safely replayable from zero; automatic production `supabase db push` remains forbidden.


### Runtime verification follow-up

The v8/v9 follow-up fixed two runtime-only issues that ordinary schema checks did not expose:

- Cron invocations previously depended on a custom Edge runtime secret that was present in Vault but not injected as an Edge Function environment variable.
- New control-plane tables had correct RLS but lacked the explicit `service_role` table ACLs required by PostgREST-backed Edge workers.

After applying `20260918050052_fix_funnel_worker_runtime_auth_v8.sql`, deploying the corrected functions, and applying `20260918050607_grant_funnel_control_service_acl_v9.sql`, controlled `pg_net` invocations returned:

- `funnel-command-worker`: HTTP 200, `ok:true`
- `funnel-drift-worker`: HTTP 200, `ok:true`

This is stronger evidence than the cron scheduler status alone because it validates the actual Edge Function HTTP response.


## Funnel operational mirror and public API continuation

Reviewed forward migrations applied to the linked Supabase project and mirrored in GitHub with the exact remote versions include:

- `20260918052534_crm_funnel_chat_remote_bridge_v10.sql`
- `20260918151516_funnel_operational_timeline_v11.sql`
- `20260918152707_checkout_engine_transaction_projection_v12.sql`
- `20260918153239_funnel_operational_chat_delivery_v13.sql`
- `20260918153303_fix_gateway_payment_link_sale_tenant_v13.sql`
- `20260918153559_funnel_operational_webhook_health_v14.sql`
- `20260918153812_funnel_operational_outbound_webhook_v15.sql`
- `20260918154258_fix_public_api_key_auth_digest_v16.sql`
- `20260918154709_grant_operational_timeline_service_acl_v17.sql`

This continuation adds bidirectional remote funnel chat, the unified security-invoker operational timeline, asynchronous checkout transaction projection, chat delivery/DLQ visibility, inbound/outbound webhook health, repaired external API-key hashing, and the backend read ACLs required for the scoped public operational-timeline endpoint.

Current reconciliation counts at this checkpoint:
- Live migration history: **589**
- Local SQL migration files: **356**
- Remote logical names without a local name match: **282**
- Local logical names without a remote name match: **49**
- Canonical Edge Function inventory: **44 local / 44 deployed**

Controlled runtime validation also proved the public `funnels:read` API-key path can read the per-funnel operational timeline with HTTP 200 after the v16/v17 repairs. The temporary E2E fixtures were removed after the test.

Historical migration drift remains open; these forward migrations do not make the old chain safe to replay from zero, and automatic production `supabase db push` remains forbidden.
