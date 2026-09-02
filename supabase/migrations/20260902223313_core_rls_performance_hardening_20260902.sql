drop policy if exists gateway_transactions_select_own on public.gateway_transactions;
drop policy if exists sales_select_own on public.sales;

alter policy gateway_payment_attempts_select_own on public.gateway_payment_attempts using (user_id = (select auth.uid()));
alter policy outbound_webhook_deliveries_select_own on public.outbound_webhook_deliveries using (user_id = (select auth.uid()));
alter policy outbound_webhooks_select_own on public.outbound_webhooks using (user_id = (select auth.uid()));
alter policy outbound_webhooks_insert_own on public.outbound_webhooks with check (user_id = (select auth.uid()));
alter policy outbound_webhooks_update_own on public.outbound_webhooks using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy outbound_webhooks_delete_own on public.outbound_webhooks using (user_id = (select auth.uid()));
alter policy reconciliation_items_owner_read on public.reconciliation_items using (user_id = (select auth.uid()));
alter policy reconciliation_runs_owner_read on public.reconciliation_runs using (user_id = (select auth.uid()));
alter policy risk_assessments_select_own on public.risk_assessments using (user_id = (select auth.uid()));
alter policy transaction_routing_logs_select_own on public.transaction_routing_logs using (user_id = (select auth.uid()));

create index if not exists core_job_queue_user_id_idx on public.core_job_queue(user_id);
create index if not exists gateway_health_snapshots_user_id_idx on public.gateway_health_snapshots(user_id);
create index if not exists gateway_payment_attempts_routing_rule_id_idx on public.gateway_payment_attempts(routing_rule_id);
create index if not exists transaction_audit_events_actor_user_id_idx on public.transaction_audit_events(actor_user_id);

drop index if exists public.gateway_transactions_user_idempotency_idx;
drop index if exists public.transaction_audit_events_type_created_idx;
