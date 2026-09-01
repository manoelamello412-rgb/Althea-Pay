# PR Body (auto-generated)

Title: chore(ci-security-hardening): full quick-wins, DB scaffolding, adapters & docs

This PR assembles the quick-win improvements, DB scaffolding, adapter skeletons, infra templates, and operational docs to prepare Althea Pay for staging and production work.

Changes include:
- DB migrations and PG helper (lib/db.ts)
- Webhook persistence + event worker processing
- Reconciliation worker skeleton
- Chargeback evidence helpers
- OpenTelemetry tracing stub
- Terraform IaC skeleton (AWS RDS template)
- CI workflow for DB-backed E2E (requires secrets)
- Ops runbooks and PCI checklist
- Shopify plugin placeholder

Notes:
- No secrets are committed. Configure GitHub Secrets as described in PR template and README_db_scaffolding.md
- Many modules are skeletons and require integration with external services (PSP keys, KMS, etc.)

