# Gateway Orchestrator Deployment

- Supabase function: `gateway-orchestrator`
- Active version: 53
- JWT verification: enabled
- Runtime budget: bounded adapter timeout with idempotent orchestration
- Transaction gateway binding: `bind_gateway_transaction_gateway` before each provider attempt
- Attempt allocation: `allocate_and_insert_gateway_payment_attempt`
- Transaction state authority: `transition_gateway_transaction_status`
- Candidate ranking: `rank_gateway_candidates`
- Credential resolution: `resolve_gateway_credential_for_gateway`
- Circuit admission: `acquire_gateway_circuit`
- Health/circuit telemetry is best-effort and cannot change the payment outcome
- Legacy `althea-gateway-orchestrator` remains retired

Version 53 restores the real payment orchestration path after the previous active deployment was found to contain an unrelated execution stub. No gateway connection, credential, transaction, attempt, recovery job, token link, or synthetic payment data was created by this deployment.
