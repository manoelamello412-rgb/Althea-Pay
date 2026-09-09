-- Multi-Gateway hardening: immutable security helper execution surface and canonical routing references.
create or replace function public.gateway_json_contains_forbidden_payment_data(p_value jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
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

create or replace function public.gateway_routing_graph_validate_target_refs(p_graph jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
begin
  return public.gateway_routing_graph_validator_v4(p_graph);
exception when others then return false;
end $$;

revoke execute on function public.gateway_routing_graph_validate_target_refs(jsonb) from public, anon, authenticated;
revoke execute on function public.gateway_json_contains_forbidden_payment_data(jsonb) from public, anon, authenticated;
grant execute on function public.gateway_routing_graph_validate_target_refs(jsonb) to service_role;
grant execute on function public.gateway_json_contains_forbidden_payment_data(jsonb) to service_role;

create or replace function public.gateway_fee_source_authority_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare existing_id uuid;
begin
  if new.provider_fee is null or new.provider_fee <= 0 then return new; end if;
  select ri.id into existing_id
    from public.reconciliation_items ri
   where ri.user_id = new.user_id
     and ri.transaction_id = new.transaction_id
     and ri.provider_fee is not null
     and ri.provider_fee > 0
     and ri.id <> new.id
   limit 1;
  if existing_id is not null then raise exception 'duplicate_gateway_fee_source_for_transaction'; end if;
  return new;
end $$;

drop trigger if exists trg_gateway_fee_source_authority on public.reconciliation_items;
create trigger trg_gateway_fee_source_authority
before insert or update of provider_fee,transaction_id,user_id on public.reconciliation_items
for each row execute function public.gateway_fee_source_authority_guard();

revoke execute on function public.gateway_fee_source_authority_guard() from public, anon, authenticated;
grant execute on function public.gateway_fee_source_authority_guard() to service_role;
