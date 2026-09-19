
-- idempotency_keys tinha organization_id na tabela mas a UNIQUE não a usava,
-- permitindo colisão de idempotency_key entre organizações diferentes do mesmo usuário.
-- Tabela está vazia (verificado: count=0), portanto sem risco de violação ao trocar a constraint.
alter table public.idempotency_keys
  drop constraint idempotency_keys_user_id_scope_idempotency_key_key;

alter table public.idempotency_keys
  add constraint idempotency_keys_org_user_scope_key_key
  unique (organization_id, user_id, scope, idempotency_key);
