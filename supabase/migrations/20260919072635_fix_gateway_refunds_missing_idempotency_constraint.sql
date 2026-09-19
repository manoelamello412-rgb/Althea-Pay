alter table public.gateway_refunds
  add constraint gateway_refunds_user_id_idempotency_key_key
  unique (user_id, idempotency_key);
