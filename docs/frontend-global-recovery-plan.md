# Frontend Global Recovery — Execution Plan

1. Inventory route/component ownership from the current repository.
2. Trace each route to its real data source and mutations.
3. Audit the global CSS cascade and layout primitives before local visual fixes.
4. Identify missing UI exposure of already-implemented domain capabilities.
5. Correct only proven defects, keeping existing domain ownership and data paths.
6. Validate every semantic group with CI; never claim local validation that was not run.
7. Re-audit after changes and continue until no safe relevant frontend gap remains.
