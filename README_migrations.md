# Automated apply of migrations and RLS

This repository includes a GitHub Actions workflow (.github/workflows/apply-rls.yml) that will apply the SQL migrations and RLS policies to the database defined by the `DATABASE_URL` secret.

How it runs
- The workflow triggers on push to the ci-security-hardening branch and can be invoked manually via workflow_dispatch.
- It requires the following GitHub Actions secrets to be set:
  - DATABASE_URL
  - SUPABASE_SERVICE_ROLE

Security note
- SUPABASE_SERVICE_ROLE should be stored as a secret and only provided to CI with restricted access. The workflow will fail if secrets are missing.

If you prefer to run migrations manually, you can use the script at `.github/scripts/apply_migrations.sh`:

  DATABASE_URL="your_database_url" bash .github/scripts/apply_migrations.sh

