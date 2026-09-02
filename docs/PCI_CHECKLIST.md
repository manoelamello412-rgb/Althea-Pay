# PCI & Security Checklist (starter)

1. Data flow diagrams (DFD) updated and stored in docs/arch/.
2. No PAN/CVC stored in DB or logs. Use tokenization via PSP.
3. Secrets in GitHub Secrets or Vault; no secrets in repo.
4. RLS policies created and reviewed (supabase/migrations/policies.sql).
5. SCA (Dependabot) enabled; add semgrep or snyk for scanning.
6. Schedule external pentest and obtain report; store evidence in security/.
7. Prepare SAQ or PCI DSS scope docs for auditor.

