# ALTHEA PAY — Go-Live Checklist

## Code / tests
- [ ] Build passes.
- [ ] Typecheck passes.
- [ ] Unit tests pass.
- [ ] Sandbox checkout E2E passes.
- [ ] Idempotency/replay tests pass.
- [ ] Gateway fallback tests pass.

## Security
- [ ] RLS verified for every tenant-owned table.
- [ ] No service-role secret in client code or Git history.
- [ ] Webhook signature + timestamp + replay protection verified.
- [ ] Internal worker authentication verified.
- [ ] Secrets stored server-side.
- [ ] Supabase leaked-password protection enabled.
- [ ] Owner MFA enabled.

## Payments
- [ ] Production gateway contract and credentials configured.
- [ ] Gateway webhook contract certified.
- [ ] 3DS/provider requirements validated.
- [ ] Refund and chargeback lifecycle verified.
- [ ] Reconciliation procedure tested.

## Compliance
- [ ] `BLOQUEIO EXTERNO`: PCI scope/attestation evidence completed.
- [ ] `BLOQUEIO EXTERNO`: KYC/AML policy and provider responsibilities approved.
- [ ] Legal/regulatory review completed for target markets.

## Operations
- [ ] Monitoring and alerting active.
- [ ] Backup/restore test completed.
- [ ] Rate limits verified.
- [ ] Incident runbook available.
- [ ] Production domain/DNS/SMTP configured.

**Rule:** ALTHEA PAY is not considered fully production-ready while any mandatory security/compliance/payment gate above remains unchecked.
