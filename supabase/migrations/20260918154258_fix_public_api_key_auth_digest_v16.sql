
create or replace function public.authenticate_althea_api_key(p_key text)
returns table(api_key_id uuid,user_id uuid,scopes jsonb,expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  h text;
begin
  if p_key is null or length(p_key) < 20 then
    return;
  end if;

  h := encode(extensions.digest(p_key,'sha256'),'hex');

  return query
  select k.id,k.user_id,k.scopes,k.expires_at
  from public.api_keys k
  where k.key_hash=h
    and k.revoked_at is null
    and (k.expires_at is null or k.expires_at>now())
  limit 1;
end;
$$;

revoke all on function public.authenticate_althea_api_key(text) from public,anon,authenticated;
grant execute on function public.authenticate_althea_api_key(text) to service_role;
