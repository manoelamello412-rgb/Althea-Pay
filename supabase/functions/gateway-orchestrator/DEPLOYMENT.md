# Gateway Orchestrator Deployment

- Supabase function: `gateway-orchestrator`
- Active version: 63
- JWT verification: enabled
- Runtime budget: global bounded budget with bounded per-provider timeout
- Transaction gateway binding: `bind_gateway_transaction_gateway` before each provider attempt
- Attempt allocation: `allocate_and_insert_gateway_payment_attempt`
- Transaction state authority: `transition_gateway_transaction_status`
- Candidate ranking: `rank_gateway_candidates`
- Credential resolution: `resolve_gateway_credential_for_gateway`
- Provider adapter resolves credentials server-side; orchestrator does not send plaintext provider credentials
- Circuit admission: `acquire_gateway_circuit`
- Terminal failure: created transactions are explicitly transitioned to `failed` after exhausted/timeout orchestration
- Health/circuit telemetry is best-effort and cannot change the payment outcome
- Legacy `althea-gateway-orchestrator` remains retired

Version 63 hardens global execution budget, terminal failure semantics, and adapter credential isolation. No gateway connection, credential, transaction, attempt, recovery job, token link, or synthetic payment data was created by this deployment.
