# Core Worker

Internal worker for the Althea Pay core queue.

- Authenticates with `x-internal-secret` / `ALTHEA_INTERNAL_SECRET`.
- Recovers stale `processing` jobs before claiming new work.
- Claims jobs atomically with `FOR UPDATE SKIP LOCKED` through the database RPC.
- Processes `integration_event_retry` jobs through `integration-event-processor`.
- Uses the database retry/DLQ boundary instead of unbounded in-memory retries.

The worker does not connect real gateways. External gateway integrations remain a separate final integration layer.
