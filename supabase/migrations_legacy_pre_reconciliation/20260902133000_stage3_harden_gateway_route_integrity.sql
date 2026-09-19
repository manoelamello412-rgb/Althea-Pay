-- Stage 3: gateway routing integrity.
-- Routes are executable payment configuration and must always point to a
-- concrete funnel and gateway owned by the same tenant. Gateway deletion
-- cascades its routes; transaction history remains independently preserved.

alter table public.gateway_routes
  alter column funnel_id set not null;

alter table public.gateway_routes
  alter column gateway_id set not null;

alter table public.gateway_routes
  drop constraint if exists gateway_routes_gateway_id_fkey;

alter table public.gateway_routes
  add constraint gateway_routes_gateway_id_fkey
  foreign key (gateway_id)
  references public.gateways(id)
  on delete cascade;

create index if not exists gateway_routes_user_funnel_priority_idx
  on public.gateway_routes(user_id, funnel_id, enabled, priority);
