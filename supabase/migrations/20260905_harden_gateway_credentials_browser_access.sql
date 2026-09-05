create or replace function public.list_gateway_credentials()
returns table(id uuid, gateway_name text, is_active boolean, priority_order integer, metadata jsonb)
language sql
security definer
set search_path = public, extensions
as $$
  select c.id, c.gateway_name, c.is_active, c.priority_order, c.metadata
  from public.user_gateway_credentials c
  where c.user_id = auth.uid()
  order by c.priority_order asc, c.gateway_name asc;
$$;

revoke all on function public.list_gateway_credentials() from public;
grant execute on function public.list_gateway_credentials() to authenticated;

create or replace function public.set_gateway_credential_status(p_credential_id uuid, p_is_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  update public.user_gateway_credentials
     set is_active = coalesce(p_is_active, false),
         updated_at = timezone('utc', now())
   where id = p_credential_id and user_id = auth.uid()
   returning id into v_id;
  if v_id is null then raise exception 'credential_not_found'; end if;
  return jsonb_build_object('id', v_id, 'is_active', coalesce(p_is_active, false));
end;
$$;

revoke all on function public.set_gateway_credential_status(uuid, boolean) from public;
grant execute on function public.set_gateway_credential_status(uuid, boolean) to authenticated;

revoke all on public.user_gateway_credentials from anon, authenticated;
