create unique index if not exists gateway_payment_links_active_idem_idx on public.gateway_payment_links(user_id,idempotency_key);
