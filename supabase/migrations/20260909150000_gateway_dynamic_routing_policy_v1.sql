create table if not exists public.gateway_routing_policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  funnel_id text not null,
  name text not null,
  is_active boolean not null default true,
  routing_graph jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gateway_routing_policies_name_ck check (length(trim(name)) between 1 and 100),
  constraint gateway_routing_policies_graph_object_ck check (jsonb_typeof(routing_graph) = 'object')
);

create index if not exists gateway_routing_policies_tenant_funnel_idx on public.gateway_routing_policies(user_id, funnel_id, updated_at desc);
create unique index if not exists gateway_routing_policies_active_unique_idx on public.gateway_routing_policies(user_id, funnel_id) where is_active = true;

alter table public.gateway_routing_policies enable row level security;
drop policy if exists gateway_routing_policies_select_own on public.gateway_routing_policies;
create policy gateway_routing_policies_select_own on public.gateway_routing_policies for select to authenticated using (user_id = auth.uid());
drop policy if exists gateway_routing_policies_insert_own on public.gateway_routing_policies;
create policy gateway_routing_policies_insert_own on public.gateway_routing_policies for insert to authenticated with check (user_id = auth.uid());
drop policy if exists gateway_routing_policies_update_own on public.gateway_routing_policies;
create policy gateway_routing_policies_update_own on public.gateway_routing_policies for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists gateway_routing_policies_delete_own on public.gateway_routing_policies;
create policy gateway_routing_policies_delete_own on public.gateway_routing_policies for delete to authenticated using (user_id = auth.uid());

create or replace function public.validate_gateway_routing_graph(p_graph jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = public, extensions
as $$
declare
  v_root jsonb;
  v_type text;
begin
  if p_graph is null or jsonb_typeof(p_graph) <> 'object' then return false; end if;
  v_root := p_graph->'root';
  if v_root is null or jsonb_typeof(v_root) <> 'object' then return false; end if;
  v_type := v_root->>'type';
  if v_type not in ('direct','split','conditional') then return false; end if;
  return true;
end;
$$;

alter table public.gateway_routing_policies drop constraint if exists gateway_routing_policies_graph_valid_ck;
alter table public.gateway_routing_policies add constraint gateway_routing_policies_graph_valid_ck check (public.validate_gateway_routing_graph(routing_graph));

revoke all on function public.validate_gateway_routing_graph(jsonb) from public, anon, authenticated;
grant execute on function public.validate_gateway_routing_graph(jsonb) to authenticated;
