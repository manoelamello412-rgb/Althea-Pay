alter table public.gateways add column if not exists circuit_id uuid default gen_random_uuid();
alter table public.gateways alter column circuit_id set not null;
create unique index if not exists gateways_circuit_id_uq on public.gateways(circuit_id);
comment on column public.gateways.circuit_id is 'Stable UUID used exclusively by circuit-breaker and health infrastructure; public gateway id remains the legacy routing key.';
