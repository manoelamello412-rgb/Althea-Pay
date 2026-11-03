create table public.customer_identities(organization_id uuid, user_id uuid, client_id text, kind text, value text, unique(organization_id, user_id, kind, value));
create table public.crm_contact_lists(id uuid primary key default gen_random_uuid(), organization_id uuid, user_id uuid, name text, unique(organization_id, name));
create table public.crm_contact_list_members(list_id uuid, organization_id uuid, user_id uuid, client_id text, unique(list_id, client_id));
create function private.normalize_customer_identity(p_kind text, p_value text) returns text language sql immutable as $$
  select v from (select regexp_replace(coalesce(p_value,''),'[^0-9]+','','g') v) x where length(v) between 8 and 15 $$;
-- Simplified resolve_customer: one client per phone, name only when new.
create function private.resolve_customer(p_org uuid, p_user uuid, p_email text, p_phone text, p_visitor text, p_client text, p_profile jsonb) returns text language plpgsql as $$
declare v text; n text := private.normalize_customer_identity('phone', p_phone);
begin
  select client_id into v from public.customer_identities where organization_id = p_org and kind = 'phone' and value = n;
  if v is null then
    v := gen_random_uuid()::text;
    insert into public.clients(id, organization_id, user_id, data) values (v, p_org, p_user, p_profile || jsonb_build_object('phone', n));
    insert into public.customer_identities values (p_org, p_user, v, 'phone', n);
  end if;
  return v;
end $$;
