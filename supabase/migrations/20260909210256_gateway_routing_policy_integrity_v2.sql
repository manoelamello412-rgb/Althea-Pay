create or replace function public.validate_gateway_routing_graph(p_graph jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  node jsonb;
  child jsonb;
  total numeric;
  typ text;
  seen text[] := array[]::text[];
  stack jsonb[] := array[p_graph];
  depth int;
  key text;
  w numeric;
  cond jsonb;
  true_branch jsonb;
  false_branch jsonb;
begin
  if p_graph is null or jsonb_typeof(p_graph) <> 'object' then return false; end if;
  while coalesce(array_length(stack,1),0) > 0 loop
    node := stack[array_length(stack,1)]; stack := stack[1:array_length(stack,1)-1];
    if jsonb_typeof(node) <> 'object' then return false; end if;
    depth := coalesce(jsonb_array_length(node->'__path'),0);
    if depth > 16 then return false; end if;
    typ := lower(coalesce(node->>'type',node->>'node_type',''));
    if typ not in ('direct','split','conditional') then return false; end if;
    key := coalesce(nullif(node->>'id',''), md5(node::text));
    if key = any(seen) then return false; end if;
    seen := array_append(seen,key);
    if typ = 'direct' then
      if coalesce(nullif(node->>'gateway_id',''),nullif(node->>'gatewayId',''),nullif(node->>'id','')) is null then return false; end if;
    elsif typ = 'split' then
      if jsonb_typeof(coalesce(node->'targets',node->'gateways',node->'children')) <> 'array' then return false; end if;
      total := 0;
      for child in select value from jsonb_array_elements(coalesce(node->'targets',node->'gateways',node->'children')) loop
        if jsonb_typeof(child) <> 'object' then return false; end if;
        if coalesce(nullif(child->>'gateway_id',''),nullif(child->>'gatewayId',''),nullif(child->>'id','')) is null then return false; end if;
        w := nullif(child->>'weight','')::numeric;
        if w is null or w <= 0 then return false; end if;
        total := total + w;
        if child ? 'node' and jsonb_typeof(child->'node')='object' then stack := array_append(stack, child->'node' || jsonb_build_object('__path', jsonb_build_array(1))); end if;
        if child ? 'child' and jsonb_typeof(child->'child')='object' then stack := array_append(stack, child->'child' || jsonb_build_object('__path', jsonb_build_array(1))); end if;
      end loop;
      if abs(total - 100) > 0.0001 then return false; end if;
    else
      cond := node->'condition';
      if cond is null or (jsonb_typeof(cond) not in ('object','string','boolean')) then return false; end if;
      true_branch := coalesce(node->'if_true',node->'then',node->'true',node->'yes',node->'on_true');
      false_branch := coalesce(node->'if_false',node->'else',node->'false',node->'no',node->'on_false');
      if jsonb_typeof(true_branch) <> 'object' and jsonb_typeof(false_branch) <> 'object' then return false; end if;
      if jsonb_typeof(true_branch)='object' then stack := array_append(stack,true_branch); end if;
      if jsonb_typeof(false_branch)='object' then stack := array_append(stack,false_branch); end if;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create or replace function public.enforce_gateway_routing_policy_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  gid text;
  exists_gateway boolean;
begin
  if not public.validate_gateway_routing_graph(new.routing_graph) then
    raise exception 'invalid_gateway_routing_graph';
  end if;
  for gid in
    select distinct x.value
    from jsonb_path_query(new.routing_graph, '$.**.gateway_id') x(value)
  loop
    select exists(
      select 1 from public.gateways g
      where g.id = gid and g.user_id = new.user_id and g.status <> 'disabled'
    ) into exists_gateway;
    if not exists_gateway then
      raise exception 'routing_policy_gateway_not_owned_or_active:%', gid;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_gateway_routing_policy_integrity on public.gateway_routing_policies;
create trigger trg_gateway_routing_policy_integrity
before insert or update of routing_graph,user_id,funnel_id,is_active
on public.gateway_routing_policies
for each row execute function public.enforce_gateway_routing_policy_integrity();

revoke all on function public.enforce_gateway_routing_policy_integrity() from public, anon, authenticated;
revoke all on function public.validate_gateway_routing_graph(jsonb) from public, anon;
grant execute on function public.validate_gateway_routing_graph(jsonb) to authenticated;
