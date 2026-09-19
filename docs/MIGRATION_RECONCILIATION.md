# Althea Pay — Migration Reconciliation

## Current canonical state

Reconciliation completed on 2026-09-18.

The active GitHub migration directory is now rebuilt from the migration history actually applied to the live Supabase project.

Verified canonical inventory:
- Live Supabase migration history: **624** migrations.
- GitHub `supabase/migrations`: **624** migrations.
- Migration filename/version set: **exact match** with the live history.
- Legacy local-only migrations: removed from the active repository history.
- Supabase Edge Functions: **46 active**.
- GitHub Edge Function directories: **46**.
- `supabase/config.toml` function entries: **46**.
- `types/supabase.ts`: regenerated from the live production schema.

## Source-of-truth rule

GitHub is the canonical source for application code, reviewed database migrations, Supabase Edge Functions, configuration, and generated database types.

Supabase is the live runtime/backend state. Direct production changes that are not represented in GitHub are drift and must not become the new canonical state automatically.

When drift is detected:
1. compare the live change against tests, security contracts, runtime dependencies, and the current canonical code;
2. keep only changes that are valid and intentional;
3. reject regressions, duplicates, obsolete implementations, and untracked parallel versions;
4. update GitHub first with the reviewed canonical result;
5. deploy the reviewed canonical result back to the runtime.

## Deployment rules

- Production database changes remain review-gated; CI must not run an automatic `supabase db push`.
- Edge Function inventory must match `supabase/config.toml`.
- Migration versions in `supabase/migrations` must be unique and use canonical timestamped filenames.
- Generated Supabase types must be refreshed after reviewed schema changes.
- The Edge Function deployment may use `--prune` only when the repository inventory has passed CI and is the reviewed canonical inventory.

## Important reconciliation decision

The live Supabase backend was **not** copied blindly.

During reconciliation, a live `automation-engine-v2` revision that had lost the required `ALTHEA_INTERNAL_SECRET` protection was rejected. The protected canonical implementation was retained instead.

This is the governing rule for future synchronization: synchronization means aligning the services to the reviewed canonical implementation, not automatically accepting whichever side changed most recently.
