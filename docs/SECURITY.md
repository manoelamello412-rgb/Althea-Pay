# ALTHEA PAY — Security Baseline

## Non-negotiables
- Never commit secrets, service-role keys, gateway credentials, PAN or CVC.
- Browser clients use only publishable/anon Supabase credentials.
- Tenant-owned records must be protected by RLS.
- Webhooks are untrusted input: verify signature, timestamp and replay/idempotency before mutation.
- Internal workers remain authenticated with an internal secret.
- Logs must redact credentials and payment card data.

## HTTP security
The Next.js configuration sets baseline response headers including HSTS, frame protection, content-type sniffing protection, referrer policy and a CSP compatible with Supabase Realtime/API usage.

## Secrets
`ALTHEA_INTERNAL_SECRET` must be provisioned through a server-side secret store (Supabase Vault or equivalent). It must never be placed in GitHub source, browser JavaScript, or public environment variables.

## Incident priorities
1. Credential exposure: revoke/rotate immediately.
2. Cross-tenant data exposure: disable affected surface and investigate RLS/policy path.
3. Duplicate payment command: identify idempotency breach and stop automated retries.
4. Webhook replay: quarantine delivery and inspect signature/timestamp/idempotency controls.

## Remaining external work
- `BLOQUEIO EXTERNO`: owner MFA and leaked-password protection must be enabled in Supabase Auth.
- `BLOQUEIO EXTERNO`: production secret provisioning.
- `BLOQUEIO EXTERNO`: independent security review before handling production payment traffic.
