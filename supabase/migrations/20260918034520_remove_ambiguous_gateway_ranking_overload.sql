-- The six-argument function has DEFAULT NULL for card brand, so it already
-- accepts calls with five arguments. A second five-argument overload makes
-- those calls ambiguous (42725). No catalog dependencies reference it.
-- RESTRICT prevents removal if any dependent object appears before deployment.
begin;
drop function public.gateway_runtime_route_candidates(uuid,text[],numeric,text,text) restrict;
-- Check both call forms before committing; these inputs never select a gateway.
do $check$
begin
 perform * from public.gateway_runtime_route_candidates('00000000-0000-0000-0000-000000000000'::uuid,array[]::text[],1::numeric,'BRL'::text,'sandbox'::text);
 perform * from public.gateway_runtime_route_candidates('00000000-0000-0000-0000-000000000000'::uuid,array[]::text[],1::numeric,'BRL'::text,'sandbox'::text,null::text);
end;
$check$;
commit;
