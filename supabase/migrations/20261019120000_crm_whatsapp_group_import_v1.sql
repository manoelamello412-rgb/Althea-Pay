-- Imports the participants of a WhatsApp group (read by the Baileys bridge) as leads.
-- Each phone goes through resolve_customer: an existing customer with that phone is reused, otherwise
-- a new client is created. The leads also go to a contact list named after the group, ready for
-- campaigns. Same capability as the WhatsApp pairing (the group list comes from it).
create or replace function public.crm_whatsapp_import_leads(p_group_name text, p_phones text[])
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
  v_phone text;
  v_client text;
  v_ids text[] := '{}';
  v_list_id uuid;
  v_list text := coalesce(nullif(left(btrim(coalesce(p_group_name, '')), 80), ''), 'Grupo do WhatsApp');
begin
  select * into c from private.crm_config_context('can_manage_integrations');
  if coalesce(cardinality(p_phones), 0) not between 1 and 5000 then raise exception 'IMPORT_PHONES_INVALID' using errcode = '22023'; end if;
  foreach v_phone in array p_phones loop
    if private.normalize_customer_identity('phone', v_phone) is null then continue; end if;
    v_client := private.resolve_customer(c.organization_id, c.owner_id, null, v_phone, null, null,
      jsonb_build_object('source', 'whatsapp_group', 'whatsapp_group', left(btrim(coalesce(p_group_name, '')), 120)));
    if v_client is not null and not v_client = any(v_ids) then v_ids := array_append(v_ids, v_client); end if;
  end loop;
  if cardinality(v_ids) > 0 then
    insert into public.crm_contact_lists (organization_id, user_id, name) values (c.organization_id, c.owner_id, v_list)
    on conflict (organization_id, name) do update set name = excluded.name
    returning id into v_list_id;
    insert into public.crm_contact_list_members (list_id, organization_id, user_id, client_id)
    select v_list_id, c.organization_id, c.owner_id, unnest(v_ids)
    on conflict do nothing;
  end if;
  insert into public.audit_logs (user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.whatsapp.group_imported', 'whatsapp_group', left(coalesce(p_group_name, ''), 120),
          jsonb_build_object('received', cardinality(p_phones), 'imported', cardinality(v_ids)));
  return jsonb_build_object('imported', cardinality(v_ids), 'client_ids', to_jsonb(v_ids), 'list_id', v_list_id, 'list_name', case when v_list_id is not null then v_list end);
end;
$function$;

revoke all on function public.crm_whatsapp_import_leads(text, text[]) from public, anon;
grant execute on function public.crm_whatsapp_import_leads(text, text[]) to authenticated;
