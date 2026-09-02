# PR: CI & migrations fixes

This PR contains small reliability fixes for CI and the migrations workflow:

- CI: make the typecheck step tolerant when a "typecheck" npm script is not defined (uses --if-present and a clear message). Also make tests run with --if-present.
- Apply migrations & RLS workflow: require only DATABASE_URL to run migrations; if SUPABASE_SERVICE_ROLE is not provided, skip applying policies and print a clear message (prevents hard failure when policies deploy key is not set).

These changes improve developer experience and reduce CI failures when optional env vars or scripts are not present.
