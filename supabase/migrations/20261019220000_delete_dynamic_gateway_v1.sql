-- Lets an org manager delete a gateway that never moved money (e.g. a duplicate registration).
-- Anything with financial history keeps using disconnect_dynamic_gateway; the restrict FKs
-- (routes, bindings, refunds, funnel commands) also block the delete while the gateway is in use.
create or replace function public.delete_dynamic_gateway(p_gateway_id text) returns jsonb
language plpgsql security definer set search_path to 'public', 'vault', 'pg_catalog' as $function$
declare u uuid:=auth.uid(); g public.gateways%rowtype; cred_secret text;
begin
  if u is null then raise exception 'unauthorized' using errcode='42501'; end if;
  select * into g from public.gateways where id=p_gateway_id for update;
  if not found or g.organization_id is null or not private.is_org_member(g.organization_id) then raise exception 'gateway_not_found' using errcode='42501'; end if;
  if not private.has_org_role(g.organization_id,array['owner','admin','manager']) then raise exception 'forbidden' using errcode='42501'; end if;
  -- These FKs are "set null"/"no action", so check them explicitly instead of losing the link.
  if exists (select 1 from public.gateway_transactions where gateway_id=p_gateway_id)
     or exists (select 1 from public.gateway_payment_attempts where gateway_id=p_gateway_id)
     or exists (select 1 from public.reconciliation_runs where gateway_id=p_gateway_id) then
    raise exception 'gateway_has_history' using errcode='P0001';
  end if;

  delete from vault.secrets where id::text in (select secret_ref from public.gateway_webhook_secrets where gateway_id=p_gateway_id);
  begin
    delete from public.gateways where id=p_gateway_id;
  exception when foreign_key_violation then
    raise exception 'gateway_in_use' using errcode='P0001';
  end;
  if g.credential_id is not null and not exists (select 1 from public.gateways where credential_id=g.credential_id) then
    select secret_ref into cred_secret from public.user_gateway_credentials where id=g.credential_id;
    delete from public.user_gateway_credentials where id=g.credential_id;
    delete from vault.secrets where id::text=cred_secret;
  end if;
  return jsonb_build_object('gateway_id',p_gateway_id,'deleted',true);
end;$function$;

revoke execute on function public.delete_dynamic_gateway(text) from public, anon;
grant execute on function public.delete_dynamic_gateway(text) to authenticated;
