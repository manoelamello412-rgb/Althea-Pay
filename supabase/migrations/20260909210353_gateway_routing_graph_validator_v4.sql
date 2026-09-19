create or replace function public.gateway_routing_graph_condition_valid(p_condition jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $fn$
declare field text; op text; expected jsonb; item jsonb;
begin
  if jsonb_typeof(p_condition) in ('boolean','string') then return true; end if;
  if jsonb_typeof(p_condition) <> 'object' then return false; end if;
  if jsonb_typeof(p_condition->'all')='array' then
    for item in select value from jsonb_array_elements(p_condition->'all') loop if not public.gateway_routing_graph_condition_valid(item) then return false; end if; end loop; return true;
  end if;
  if jsonb_typeof(p_condition->'any')='array' then
    for item in select value from jsonb_array_elements(p_condition->'any') loop if not public.gateway_routing_graph_condition_valid(item) then return false; end if; end loop; return true;
  end if;
  field := lower(coalesce(p_condition->>'field',p_condition->>'key',''));
  op := lower(coalesce(p_condition->>'operator',p_condition->>'op','eq'));
  expected := coalesce(p_condition->'value',p_condition->'expected');
  return field in ('card_brand','country','currency','payment_method','amount','risk_score','provider','environment','funnel_id','product_id')
    and op in ('eq','equals','==','neq','not_equals','!=','in','not_in','gt','>','gte','>=','lt','<','lte','<=','contains')
    and expected is not null
    and (op not in ('in','not_in') or jsonb_typeof(expected)='array');
exception when others then return false;
end;
$fn$;

create or replace function public.gateway_routing_graph_walk(p_node jsonb, p_depth integer default 0, p_path text[] default array[]::text[])
returns boolean
language plpgsql
immutable
set search_path = public
as $fn$
declare typ text; node_key text; child jsonb; branch jsonb; total numeric := 0; w numeric; condition jsonb;
begin
  if p_node is null or jsonb_typeof(p_node) <> 'object' or p_depth > 16 then return false; end if;
  typ := lower(coalesce(p_node->>'type',p_node->>'node_type',''));
  if typ not in ('direct','split','conditional') then return false; end if;
  node_key := coalesce(nullif(p_node->>'id',''), md5(p_node::text));
  if node_key = any(p_path) then return false; end if;
  p_path := array_append(p_path,node_key);
  if typ = 'direct' then return coalesce(nullif(p_node->>'gateway_id',''),nullif(p_node->>'gatewayId',''),nullif(p_node->>'id','')) is not null; end if;
  if typ = 'split' then
    if jsonb_typeof(coalesce(p_node->'targets',p_node->'gateways',p_node->'children')) <> 'array' then return false; end if;
    for child in select value from jsonb_array_elements(coalesce(p_node->'targets',p_node->'gateways',p_node->'children')) loop
      if jsonb_typeof(child) <> 'object' then return false; end if;
      if coalesce(nullif(child->>'gateway_id',''),nullif(child->>'gatewayId',''),nullif(child->>'id','')) is null then return false; end if;
      begin w := (child->>'weight')::numeric; exception when others then return false; end;
      if w is null or w <= 0 then return false; end if;
      total := total + w;
      if jsonb_typeof(child->'node')='object' and not public.gateway_routing_graph_walk(child->'node',p_depth+1,p_path) then return false; end if;
      if jsonb_typeof(child->'child')='object' and not public.gateway_routing_graph_walk(child->'child',p_depth+1,p_path) then return false; end if;
    end loop;
    return abs(total-100) <= 0.0001;
  end if;
  condition := p_node->'condition';
  if condition is null or not public.gateway_routing_graph_condition_valid(condition) then return false; end if;
  for branch in select v from jsonb_each(p_node) e(k,v) where e.k in ('if_true','then','true','yes','on_true','if_false','else','false','no','on_false') loop
    if jsonb_typeof(branch)='object' and not public.gateway_routing_graph_walk(branch,p_depth+1,p_path) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$fn$;

create or replace function public.validate_gateway_routing_graph(p_graph jsonb)
returns boolean
language sql
immutable
set search_path = public
as $fn$ select public.gateway_routing_graph_walk(p_graph,0,array[]::text[]) $fn$;

revoke all on function public.gateway_routing_graph_walk(jsonb,integer,text[]) from public,anon,authenticated;
revoke all on function public.gateway_routing_graph_condition_valid(jsonb) from public,anon,authenticated;
revoke all on function public.validate_gateway_routing_graph(jsonb) from public,anon;
grant execute on function public.validate_gateway_routing_graph(jsonb) to authenticated;
