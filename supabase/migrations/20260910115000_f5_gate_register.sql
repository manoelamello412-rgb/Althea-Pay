insert into public.production_readiness_gates (gate_name, required, status, evidence, updated_at)
values
('F5-B authority_graph_trust_boundary', true, 'pending', jsonb_build_object('boundary','gateway-orchestrator v48','enforcement','JWT + RS256 FEB + identity + command + fingerprint + fail-closed','missing','Kernel FEB issuer integration'), now()),
('F5-C separation_of_functions', true, 'pending', jsonb_build_object('shadow_runtime_removed', true,'financial_execution','disabled_at_gateway_boundary','missing','Kernel convergence for every financial writer'), now()),
('F5-D feb_contract', true, 'pending', jsonb_build_object('ticket_table','feb_consumed_tickets','jti_primary_key',true,'missing','production issuer and canonical ticket lifecycle'), now()),
('F5-E anti_replay', true, 'pending', jsonb_build_object('consume_once_insert',true,'duplicate_code','TICKET_REPLAYED','persistent_table','feb_consumed_tickets','live_ticket_replay_test','pending'), now()),
('F5-F unknown_external_effect', true, 'pending', jsonb_build_object('recovery_queue_present',true,'blind_retry_forbidden',true,'field_proof','pending'), now()),
('F5-G psp_idempotency', true, 'pending', jsonb_build_object('psp_execution','fail_closed','provider_contract_tests','existing','live_mutation_proof','pending'), now()),
('F5-H recovery', true, 'pass', jsonb_build_object('recovery_queue','present','status_requery_only','true','blind_retry','forbidden'), now()),
('F5-I independent_audit', true, 'pending', jsonb_build_object('independent_evaluator','present','evaluation_tables','present','kernel_wiring','pending'), now()),
('F5-J ci_mandatory', true, 'pending', jsonb_build_object('branch_protection','not_enabled_on_feature_branch','ci','existing','mandatory_status_proof','pending'), now()),
('F5-K promotion', true, 'fail', jsonb_build_object('reason','financial execution remains intentionally unavailable until Kernel issuer and authority convergence are complete'), now()),
('F5-L evidence_integrity', true, 'fail', jsonb_build_object('vercel_status','failure','known_failure','build-rate-limit','live_adversarial_field_test','not_executed'), now())
on conflict (gate_name) do update set required=excluded.required,status=excluded.status,evidence=excluded.evidence,updated_at=excluded.updated_at;
