CREATE OR REPLACE FUNCTION public.gateway_json_contains_forbidden_payment_data(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
declare k text; v jsonb;
begin
  if p_value is null then return false; end if;
  if jsonb_typeof(p_value)='object' then
    for k,v in select key,value from jsonb_each(p_value) loop
      if lower(regexp_replace(k,'[^a-z0-9]','','g')) in ('pan','cardnumber','cardnum','cvv','cvc','securitycode','securitynumber','expiration','expiry','expirymonth','expiryyear','trackdata','magstripe') then return true; end if;
      if public.gateway_json_contains_forbidden_payment_data(v) then return true; end if;
    end loop;
  elsif jsonb_typeof(p_value)='array' then
    for v in select value from jsonb_array_elements(p_value) loop
      if public.gateway_json_contains_forbidden_payment_data(v) then return true; end if;
    end loop;
  end if;
  return false;
end $$;

CREATE OR REPLACE FUNCTION public.gateway_routing_graph_validate_target_refs(p_graph jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  return public.gateway_routing_graph_validator_v4(p_graph);
exception when others then return false;
end $$;

REVOKE ALL ON FUNCTION public.gateway_json_contains_forbidden_payment_data(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gateway_routing_graph_validate_target_refs(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_json_contains_forbidden_payment_data(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.gateway_routing_graph_validate_target_refs(jsonb) TO service_role;