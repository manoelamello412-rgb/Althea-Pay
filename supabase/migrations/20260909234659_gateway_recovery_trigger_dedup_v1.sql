drop trigger if exists trg_enqueue_gateway_attempt_recovery on public.gateway_payment_attempts;
drop function if exists public.enqueue_gateway_attempt_recovery();