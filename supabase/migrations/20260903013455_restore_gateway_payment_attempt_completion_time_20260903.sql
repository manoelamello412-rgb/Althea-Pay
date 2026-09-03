alter table public.gateway_payment_attempts add column if not exists completed_at timestamp with time zone;
comment on column public.gateway_payment_attempts.completed_at is 'Timestamp when the gateway attempt reached a terminal or provider-confirmed state.';
