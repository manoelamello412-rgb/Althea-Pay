create or replace function public.resolve_gateway_payment_token(p_link_id uuid)
returns text
language plpgsql
security definer
set search_path=public,vault
as $$
declare v_ref text; v_token text; v_user uuid:=auth.uid(); v_owner uuid;
begin
  select user_id, secret_ref into v_owner, v_ref from public.gateway_payment_token_links where id=p_link_id and status='active';
  if v_ref is null then raise exception 'payment_token_not_found'; end if;
  if v_user is not null and v_owner <> v_user then raise exception 'payment_token_not_found'; end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where id=v_ref::uuid;
  if v_token is null then raise exception 'payment_token_secret_missing'; end if;
  return v_token;
end;
$$;

create or replace function public.revoke_gateway_payment_token_link(p_link_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare v_user uuid:=auth.uid(); v_rows integer;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  update public.gateway_payment_token_links
     set status='revoked', updated_at=now()
   where id=p_link_id and user_id=v_user and status='active';
  get diagnostics v_rows=row_count;
  return v_rows=1;
end;
$$;

create or replace function public.rotate_gateway_payment_token_link(p_link_id uuid,p_token text,p_token_fingerprint text default null)
returns uuid
language plpgsql
security definer
set search_path=public,vault
as $$
declare v_user uuid:=auth.uid(); v_owner uuid; v_gateway text; v_provider text; v_secret uuid;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if p_token is null or length(trim(p_token))<1 or length(p_token)>4096 then raise exception 'invalid_provider_token'; end if;
  select user_id,gateway_id,provider into v_owner,v_gateway,v_provider from public.gateway_payment_token_links where id=p_link_id and status='active';
  if v_owner is null or v_owner<>v_user then raise exception 'payment_token_not_found'; end if;
  if not exists(select 1 from public.gateways where id=v_gateway and user_id=v_user and lower(status) in ('connected','degraded')) then raise exception 'gateway_not_eligible'; end if;
  v_secret:=vault.create_secret(p_token,'althea_gateway_token_rotation_'||gen_random_uuid()::text,'Rotated provider token for payment instrument; never a PAN/CVV');
  update public.gateway_payment_token_links set secret_ref=v_secret::text,token_fingerprint=p_token_fingerprint,updated_at=now(),status='active' where id=p_link_id and user_id=v_user;
  return p_link_id;
end;
$$;

revoke execute on function public.resolve_gateway_payment_token(uuid) from public,anon,authenticated;
grant execute on function public.resolve_gateway_payment_token(uuid) to service_role;
revoke execute on function public.revoke_gateway_payment_token_link(uuid) from public,anon;
grant execute on function public.revoke_gateway_payment_token_link(uuid) to authenticated;
grant execute on function public.revoke_gateway_payment_token_link(uuid) to service_role;
revoke execute on function public.rotate_gateway_payment_token_link(uuid,text,text) from public,anon;
grant execute on function public.rotate_gateway_payment_token_link(uuid,text,text) to authenticated;
grant execute on function public.rotate_gateway_payment_token_link(uuid,text,text) to service_role;
