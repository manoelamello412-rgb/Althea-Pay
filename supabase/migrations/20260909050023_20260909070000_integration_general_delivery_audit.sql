BEGIN;
create table if not exists public.outbound_webhook_delivery_audit (
 id uuid primary key default gen_random_uuid(),
 webhook_id uuid not null references public.outbound_webhooks(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 event_id uuid,
 event_type text not null,
 idempotency_key text not null,
 status text not null,
 attempt integer not null default 1,
 response_code integer,
 response_time_ms integer,
 error_message text,
 payload jsonb,
 next_retry_at timestamptz,
 delivered_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 unique(webhook_id,idempotency_key)
);
alter table public.outbound_webhook_delivery_audit enable row level security;
drop policy if exists outbound_webhook_delivery_audit_select_own on public.outbound_webhook_delivery_audit;
create policy outbound_webhook_delivery_audit_select_own on public.outbound_webhook_delivery_audit for select to authenticated using (auth.uid()=user_id);
create index if not exists idx_outbound_webhook_delivery_audit_user_created on public.outbound_webhook_delivery_audit(user_id,created_at desc);
create index if not exists idx_outbound_webhook_delivery_audit_webhook_created on public.outbound_webhook_delivery_audit(webhook_id,created_at desc);
COMMIT;