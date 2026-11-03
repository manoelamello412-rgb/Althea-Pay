-- Fase 5: extrator de leads de grupos/comunidades (Baileys).
-- A tela escolhe os participantes; aqui só marcamos quem já é cliente e importamos os escolhidos com o nome.

-- Quais destes telefones já são clientes da organização (mesma normalização de resolve_customer).
create or replace function public.crm_whatsapp_known_phones(p_phones text[])
returns text[]
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
begin
  select * into c from private.crm_config_context('can_manage_integrations');
  if coalesce(cardinality(p_phones), 0) > 5000 then raise exception 'IMPORT_PHONES_INVALID' using errcode = '22023'; end if;
  return coalesce((
    select array_agg(distinct p.v)
      from (select private.normalize_customer_identity('phone', x) as v from unnest(p_phones) x) p
      join public.customer_identities i on i.organization_id = c.organization_id and i.kind = 'phone' and i.value = p.v
     where p.v is not null), '{}');
end;
$function$;

-- Como crm_whatsapp_import_leads, mas recebe [{phone, name}] para guardar o nome (sem sobrescrever o que já existe).
create or replace function public.crm_whatsapp_import_contacts(p_group_name text, p_contacts jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
  v jsonb;
  v_client text;
  v_ids text[] := '{}';
  v_new integer := 0;
  v_list_id uuid;
  v_group text := left(btrim(coalesce(p_group_name, '')), 120);
  v_list text := coalesce(nullif(left(btrim(coalesce(p_group_name, '')), 80), ''), 'Grupo do WhatsApp');
begin
  select * into c from private.crm_config_context('can_manage_integrations');
  if jsonb_typeof(p_contacts) is distinct from 'array' or jsonb_array_length(p_contacts) not between 1 and 5000 then
    raise exception 'IMPORT_PHONES_INVALID' using errcode = '22023';
  end if;
  for v in select * from jsonb_array_elements(p_contacts) loop
    if private.normalize_customer_identity('phone', v->>'phone') is null then continue; end if;
    if not exists (select 1 from public.customer_identities i where i.organization_id = c.organization_id and i.kind = 'phone'
                    and i.value = private.normalize_customer_identity('phone', v->>'phone')) then
      v_new := v_new + 1;
    end if;
    v_client := private.resolve_customer(c.organization_id, c.owner_id, null, v->>'phone', null, null,
      jsonb_strip_nulls(jsonb_build_object('source', 'whatsapp_group', 'whatsapp_group', v_group,
        'name', nullif(left(btrim(coalesce(v->>'name', '')), 120), ''))));
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
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.whatsapp.group_imported', 'whatsapp_group', v_group,
          jsonb_build_object('received', jsonb_array_length(p_contacts), 'imported', cardinality(v_ids), 'new', v_new));
  return jsonb_build_object('imported', cardinality(v_ids), 'new', v_new, 'list_id', v_list_id,
                            'list_name', case when v_list_id is not null then v_list end);
end;
$function$;

revoke all on function public.crm_whatsapp_known_phones(text[]) from public, anon;
revoke all on function public.crm_whatsapp_import_contacts(text, jsonb) from public, anon;
grant execute on function public.crm_whatsapp_known_phones(text[]) to authenticated;
grant execute on function public.crm_whatsapp_import_contacts(text, jsonb) to authenticated;
