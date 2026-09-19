alter table public.disputes
  add constraint disputes_gateway_id_external_dispute_id_key
  unique (gateway_id, external_dispute_id);
