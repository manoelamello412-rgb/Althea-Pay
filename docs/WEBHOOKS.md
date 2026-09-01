# ALTHEA PAY Webhooks

Webhook processing must assume the request is hostile until proven authentic.

## Verification order
1. Read the raw request body without normalization.
2. Read provider timestamp/signature headers.
3. Reject timestamps outside the configured replay window (currently five minutes where supported).
4. Compute HMAC-SHA256 with the server-side integration secret.
5. Compare signatures using a constant-time comparison.
6. Derive a stable event key/external ID.
7. Deduplicate before mutating transaction, checkout or sale state.
8. Persist delivery status and processing errors.
9. Trigger bounded retries only for retryable failures.

## Duplicate deliveries
A provider may legitimately deliver the same webhook more than once. Duplicate delivery must be acknowledged without creating a second sale or transaction.

## Logging
Record delivery ID, integration ID, event key, outcome and timing. Never log secrets, authorization headers, PAN, CVC or full customer payment credentials.

## Production blocker
`BLOQUEIO EXTERNO`: each real provider must be certified against its actual webhook signing contract and event semantics before production enablement.
