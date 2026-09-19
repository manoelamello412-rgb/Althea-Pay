alter table public.webhook_integrations add column if not exists vault_secret_id uuid;

create or replace function public.store_webhook_secret(p_secret text, p_name text default 'Althea webhook secret')
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  if coalesce(trim(p_secret),'') = '' then raise exception 'secret_required'; end if;
  select vault.create_secret(p_secret, p_name, 'ALTHEA PAY webhook signing secret', null) into v_id;
  return v_id;
end; $$;
revoke execute on function public.store_webhook_secret(text,text) from public, anon, authenticated;
grant execute on function public.store_webhook_secret(text,text) to service_role;

create or replace function public.update_webhook_secret(p_secret_id uuid, p_secret text, p_name text default 'Althea webhook secret')
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  if coalesce(trim(p_secret),'') = '' then raise exception 'secret_required'; end if;
  select vault.update_secret(p_secret_id, p_secret, p_name, 'ALTHEA PAY webhook signing secret', null) into v_id;
  return coalesce(v_id, p_secret_id);
end; $$;
revoke execute on function public.update_webhook_secret(uuid,text,text) from public, anon, authenticated;
grant execute on function public.update_webhook_secret(uuid,text,text) to service_role;

create or replace function public.get_webhook_integration(p_endpoint_key text)
returns table(id uuid, user_id uuid, funnel_id text, provider text, secret text, status text)
language sql security definer set search_path = public, vault as $$
  select wi.id, wi.user_id, wi.funnel_id, wi.provider, coalesce(ds.decrypted_secret, '') as secret, wi.status
  from public.webhook_integrations wi
  left join vault.decrypted_secrets ds on ds.id = wi.vault_secret_id
  where wi.endpoint_key = p_endpoint_key and wi.status = 'active'
  limit 1
$$;
revoke execute on function public.get_webhook_integration(text) from public, anon, authenticated;
grant execute on function public.get_webhook_integration(text) to service_role;
create index if not exists webhook_integrations_vault_secret_idx on public.webhook_integrations(vault_secret_id);
