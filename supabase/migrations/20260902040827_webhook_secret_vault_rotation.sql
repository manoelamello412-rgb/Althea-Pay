create or replace function public.update_webhook_secret(p_secret_id uuid, p_secret text, p_name text default 'Althea webhook secret')
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  if coalesce(trim(p_secret),'') = '' then raise exception 'secret_required'; end if;
  select vault.update_secret(p_secret_id, p_secret, p_name, 'ALTHEA PAY webhook signing secret', null) into v_id;
  return coalesce(v_id, p_secret_id);
end;
$$;
revoke execute on function public.update_webhook_secret(uuid,text,text) from public, anon, authenticated;
grant execute on function public.update_webhook_secret(uuid,text,text) to service_role;
