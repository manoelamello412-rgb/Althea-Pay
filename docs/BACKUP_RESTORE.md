# Backup & Restore Checklist

## Before production

- [ ] Provider-managed database backups enabled and retention recorded.
- [ ] Logical export procedure documented.
- [ ] Restore destination is isolated from production.
- [ ] Database credentials stored in secret manager, never Git.
- [ ] RPO/RTO approved by operations.
- [ ] Restore test executed and dated.

## Restore validation

After restoring a staging copy:

- [ ] Migration/schema state matches the intended release.
- [ ] RLS is enabled on tenant tables.
- [ ] Authentication and protected routes work.
- [ ] Gateway routes and transactions are readable only by the owning tenant.
- [ ] Sandbox approved/declined/error/refund/chargeback scenarios work.
- [ ] Webhook dedupe and retry behavior works.
- [ ] Event worker processes pending events when the internal secret is available.
- [ ] Reconciliation records and audit history are intact.

## Recovery rule

Do not promote a restored database to production solely because the restore completed. Promotion requires application smoke tests, RLS validation and business-data integrity checks.
