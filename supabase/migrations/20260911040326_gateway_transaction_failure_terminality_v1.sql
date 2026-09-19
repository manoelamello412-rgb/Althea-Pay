begin;
-- No schema change: this migration records the runtime invariant hardening release.
-- The orchestrator now must transition a created transaction to failed when all eligible attempts fail or a post-creation fatal error occurs.
commit;