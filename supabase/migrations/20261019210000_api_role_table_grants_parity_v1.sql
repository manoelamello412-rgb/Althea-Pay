-- Production was created with tables not exposed to the API roles by default, so tables created by migrations
-- never got the grants local (and a default project) has. Functions run as service_role and failed to read
-- them (e.g. gateway_provider_registry -> provider_registry_lookup_failed); dashboard reads failed too.
--
-- service_role: every table, now and for tables created later (server-only role, bypasses RLS).
-- authenticated: only the grants local has AND an RLS policy exists for that role/command, so RLS still decides.
-- anon: nothing; every policy that applies to anon requires auth.uid() = user_id.

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant all on sequences to service_role;

grant delete, insert, update on public.affiliate_profiles to authenticated;
grant delete, insert, select, update on public.api_keys to authenticated;
grant select on public.api_request_logs to authenticated;
grant delete, insert, update on public.attribution_sessions to authenticated;
grant delete, insert, select, update on public.brand_identity_settings to authenticated;
grant select on public.compliance_events to authenticated;
grant select on public.core_job_queue to authenticated;
grant delete, insert, select, update on public.crm_ai_actions to authenticated;
grant select on public.crm_channel_delivery_events to authenticated;
grant delete, insert, select, update on public.crm_channel_identities to authenticated;
grant delete, insert, select, update on public.crm_channel_message_outbox to authenticated;
grant select on public.crm_channel_outbox_replay_events to authenticated;
grant delete, insert, select, update on public.crm_conversation_notes to authenticated;
grant delete, insert, select, update on public.crm_conversation_tags to authenticated;
grant delete, insert, select, update on public.crm_experiment_exposures to authenticated;
grant delete, insert, select, update on public.crm_experiment_guardrails to authenticated;
grant delete, insert, select, update on public.crm_experiment_outcomes to authenticated;
grant select on public.crm_experiment_promotions to authenticated;
grant delete, insert, select, update on public.crm_experiment_variants to authenticated;
grant delete, insert, select, update on public.crm_experiments to authenticated;
grant delete, insert, select, update on public.crm_team_members to authenticated;
grant delete, insert, update on public.crm_teams to authenticated;
grant select on public.dispute_evidence to authenticated;
grant select on public.event_dead_letters to authenticated;
grant delete, insert, select, update on public.funnel_automation_rules to authenticated;
grant delete, insert, update on public.funnel_gateway_bindings to authenticated;
grant delete, insert, update on public.funnel_ingestion_tokens to authenticated;
grant delete, insert, update on public.funnel_offers to authenticated;
grant delete, insert, update on public.funnel_step_links to authenticated;
grant delete, insert, update on public.funnel_steps to authenticated;
grant insert, select, update on public.funnel_trash to authenticated;
grant select on public.gateway_checkout_mutations to authenticated;
grant select on public.gateway_circuit_states to authenticated;
grant select on public.gateway_decline_details to authenticated;
grant delete, insert, select, update on public.gateway_interchange_fees to authenticated;
grant select on public.gateway_operator_events to authenticated;
grant select on public.gateway_payment_instruments to authenticated;
grant select on public.gateway_payment_links to authenticated;
grant select on public.gateway_payment_token_links to authenticated;
grant delete, insert, select, update on public.gateway_routes to authenticated;
grant select on public.gateway_routing_overrides to authenticated;
grant delete, insert, select, update on public.gateway_routing_policies to authenticated;
grant delete, insert, select, update on public.gateway_routing_rules to authenticated;
grant select on public.gateway_routing_split_policies to authenticated;
grant select on public.iara_anomalies to authenticated;
grant select on public.iara_causal_diagnoses to authenticated;
grant insert, select, update on public.iara_commercial_interventions to authenticated;
grant insert, select, update on public.iara_daily_reports to authenticated;
grant select on public.iara_evaluation_assertions to authenticated;
grant select on public.iara_evaluation_claims to authenticated;
grant select on public.iara_evaluation_failures to authenticated;
grant select on public.iara_evaluation_tool_calls to authenticated;
grant select on public.iara_evaluations to authenticated;
grant select on public.iara_forecasts to authenticated;
grant insert, select, update on public.iara_funnel_drafts to authenticated;
grant insert, select on public.iara_funnel_runtime_specs to authenticated;
grant select on public.iara_memory_journal to authenticated;
grant select on public.iara_memory_sequences to authenticated;
grant select on public.iara_memory_snapshots to authenticated;
grant select on public.iara_operational_telemetry to authenticated;
grant select on public.iara_pix_invoices to authenticated;
grant select on public.iara_pix_webhook_events to authenticated;
grant select on public.iara_proactive_alerts to authenticated;
grant select on public.iara_queue_dead_letters to authenticated;
grant select on public.iara_queue_jobs to authenticated;
grant select on public.iara_runs to authenticated;
grant select on public.idempotency_keys to authenticated;
grant delete, insert, update on public.integration_events to authenticated;
grant select on public.merchant_risk to authenticated;
grant delete, insert, select, update on public.organization_member_capabilities to authenticated;
grant delete, insert, update on public.organization_members to authenticated;
grant delete, update on public.organizations to authenticated;
grant delete, insert, select, update on public.outbound_webhooks to authenticated;
grant select on public.platform_api_credentials to authenticated;
grant delete, insert, select, update on public.platform_settings to authenticated;
grant insert, select, update on public.recovery_events to authenticated;
grant select on public.risk_assessments to authenticated;
grant select on public.settlements to authenticated;
grant insert, select on public.subscription_events to authenticated;
grant insert, update on public.subscriptions to authenticated;
grant delete, insert, select, update on public.team_funnel_access to authenticated;
grant insert on public.transaction_audit_events to authenticated;
grant select on public.verification_status to authenticated;
grant insert, update on public.webhook_deliveries to authenticated;
