# Webhooks

Webhooks must be validated with HMAC signatures and timestamp-based replay protection. Use the HMAC helper in lib/hmac.ts.

Replay protection:
- Each webhook request should contain a timestamp header and signature.
- Reject if timestamp is outside of +/- 5 minutes (configurable).

Idempotency:
- Webhook event IDs must be stored in table `webhook_events` to avoid duplicate processing.

Files added:
- docs/WEBHOOKS.md
