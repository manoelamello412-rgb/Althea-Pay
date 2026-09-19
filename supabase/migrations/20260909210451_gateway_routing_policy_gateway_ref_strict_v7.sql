create or replace function public.gateway_routing_graph_gateway_refs(p_node jsonb)
returns setof text
language plpgsql
immutable
set search_path=public
as $fn$
declare e record; child jsonb; gid text;
begin
 if p_node is null then return; end if;
 if jsonb_typeof(p_node)='object' then
  for e in select key,value from jsonb_each(p_node) loop
   if e.key in ('gateway_id','gatewayId') and jsonb_typeof(e.value)='string' then
    gid:=e.value #>> '{}'; if gid<>'' then return next gid; end if;
   end if;
   return query select * from public.gateway_routing_graph_gateway_refs(e.value);
  end loop;
 elsif jsonb_typeof(p_node)='array' then
  for child in select value from jsonb_array_elements(p_node) loop
   return query select * from public.gateway_routing_graph_gateway_refs(child);
  end loop;
 end if;
 return;
end;
$fn$;

create or replace function public.gateway_routing_graph_walk(p_node jsonb, p_depth integer default 0, p_path text[] default array[]::text[])
returns boolean language plpgsql immutable set search_path=public as $fn$
declare typ text; node_key text; child jsonb; branch jsonb; total numeric:=0; w numeric; condition jsonb;
begin
 if p_node is null or jsonb_typeof(p_node)<>'object' or p_depth>16 then return false; end if;
 typ:=lower(coalesce(p_node->>'type',p_node->>'node_type','')); if typ not in ('direct','split','conditional') then return false; end if;
 node_key:=coalesce(nullif(p_node->>'id',''),md5(p_node::text)); if node_key=any(p_path) then return false; end if; p_path:=array_append(p_path,node_key);
 if typ='direct' then return coalesce(nullif(p_node->>'gateway_id',''),nullif(p_node->>'gatewayId','')) is not null; end if;
 if typ='split' then
  if jsonb_typeof(coalesce(p_node->'targets',p_node->'gateways',p_node->'children'))<>'array' then return false; end if;
  for child in select value from jsonb_array_elements(coalesce(p_node->'targets',p_node->'gateways',p_node->'children')) loop
   if jsonb_typeof(child)<>'object' then return false; end if;
   if coalesce(nullif(child->>'gateway_id',''),nullif(child->>'gatewayId','')) is null then return false; end if;
   begin w:=(child->>'weight')::numeric; exception when others then return false; end;
   if w is null or w<=0 then return false; end if; total:=total+w;
   if jsonb_typeof(child->'node')='object' and not public.gateway_routing_graph_walk(child->'node',p_depth+1,p_path) then return false; end if;
   if jsonb_typeof(child->'child')='object' and not public.gateway_routing_graph_walk(child->'child',p_depth+1,p_path) then return false; end if;
  end loop; return abs(total-100)<=0.0001;
 end if;
 condition:=p_node->'condition'; if condition is null or not public.gateway_routing_graph_condition_valid(condition) then return false; end if;
 for branch in select v from jsonb_each(p_node) e(k,v) where e.k in ('if_true','then','true','yes','on_true','if_false','else','false','no','on_false') loop
  if jsonb_typeof(branch)='object' and not public.gateway_routing_graph_walk(branch,p_depth+1,p_path) then return false; end if;
 end loop; return true;
exception when others then return false; end;
$fn$;

create or replace function public.enforce_gateway_routing_policy_integrity()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare gid text; ok boolean;
begin
 if not public.validate_gateway_routing_graph(new.routing_graph) then raise exception 'invalid_gateway_routing_graph'; end if;
 for gid in select distinct public.gateway_routing_graph_gateway_refs(new.routing_graph) loop
  select exists(select 1 from public.gateways g where g.id=gid and g.user_id=new.user_id and g.status<>'disabled') into ok;
  if not ok then raise exception 'routing_policy_gateway_not_owned_or_active:%',gid; end if;
 end loop; return new;
end;
$fn$;

revoke all on function public.gateway_routing_graph_gateway_refs(jsonb) from public,anon,authenticated;
revoke all on function public.enforce_gateway_routing_policy_integrity() from public,anon,authenticated;
