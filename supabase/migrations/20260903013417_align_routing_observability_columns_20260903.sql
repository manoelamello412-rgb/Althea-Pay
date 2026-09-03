alter table public.transaction_routing_logs add column if not exists card_brand text;
comment on column public.transaction_routing_logs.card_brand is 'Normalized card brand used by Smart Routing metrics; nullable when unknown or not applicable.';
