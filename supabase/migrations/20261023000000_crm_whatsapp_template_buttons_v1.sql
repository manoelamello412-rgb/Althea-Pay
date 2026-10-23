-- Per-template button parameters for approved Infobip templates, in the template's button order.
-- QUICK_REPLY: payload echoed back on tap. URL: suffix that replaces {{1}} in a dynamic link.
-- Null = the dispatcher reads the quick replies from the approved template on Infobip.
create or replace function private.crm_whatsapp_buttons_valid(p jsonb) returns boolean language sql immutable set search_path = pg_catalog as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 10
     and not exists (select 1 from jsonb_array_elements(p) b
                      where jsonb_typeof(b) <> 'object' or coalesce(b->>'type', '') not in ('QUICK_REPLY', 'URL')
                         or jsonb_typeof(b->'parameter') <> 'string' or length(b->>'parameter') > 2000)
$$;

alter table public.crm_message_templates add column if not exists whatsapp_buttons jsonb;
alter table public.crm_message_templates drop constraint if exists crm_message_templates_whatsapp_buttons_check;
alter table public.crm_message_templates add constraint crm_message_templates_whatsapp_buttons_check
  check (whatsapp_buttons is null or private.crm_whatsapp_buttons_valid(whatsapp_buttons));

drop function if exists public.crm_template_save(uuid, text, text, text, text[], text, text, text, text, boolean, text, text);
create or replace function public.crm_template_save(
  p_id uuid,
  p_name text,
  p_channel text,
  p_body text,
  p_variables text[] default '{}',
  p_subject text default null,
  p_whatsapp_template_name text default null,
  p_language text default 'pt_BR',
  p_trigger_event text default null,
  p_active boolean default true,
  p_whatsapp_header_type text default null,
  p_whatsapp_header_url text default null,
  p_whatsapp_buttons jsonb default null
)
returns public.crm_message_templates
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
  v public.crm_message_templates;
  v_header_type text := nullif(btrim(p_whatsapp_header_type), '');
  v_header_url text := case when nullif(btrim(p_whatsapp_header_type), '') is null then null else nullif(btrim(p_whatsapp_header_url), '') end;
  v_buttons jsonb := case when jsonb_typeof(p_whatsapp_buttons) = 'array' and jsonb_array_length(p_whatsapp_buttons) > 0 then p_whatsapp_buttons end;
begin
  select * into c from private.crm_config_context('can_manage_automations');
  begin
    if p_id is null then
      insert into public.crm_message_templates(organization_id, user_id, name, channel, body, variables, subject, whatsapp_template_name, language, trigger_event, active, whatsapp_header_type, whatsapp_header_url, whatsapp_buttons)
      values (c.organization_id, c.owner_id, btrim(p_name), p_channel, btrim(p_body), coalesce(p_variables, '{}'), nullif(btrim(p_subject), ''),
              nullif(btrim(p_whatsapp_template_name), ''), coalesce(nullif(btrim(p_language), ''), 'pt_BR'), nullif(p_trigger_event, ''), coalesce(p_active, true),
              v_header_type, v_header_url, v_buttons)
      returning * into v;
    else
      update public.crm_message_templates
         set name = btrim(p_name), channel = p_channel, body = btrim(p_body), variables = coalesce(p_variables, '{}'),
             subject = nullif(btrim(p_subject), ''), whatsapp_template_name = nullif(btrim(p_whatsapp_template_name), ''),
             language = coalesce(nullif(btrim(p_language), ''), 'pt_BR'), trigger_event = nullif(p_trigger_event, ''),
             active = coalesce(p_active, true), whatsapp_header_type = v_header_type, whatsapp_header_url = v_header_url,
             whatsapp_buttons = v_buttons, updated_at = now()
       where id = p_id and organization_id = c.organization_id
      returning * into v;
      if not found then raise exception 'TEMPLATE_NOT_FOUND' using errcode='P0002'; end if;
    end if;
  exception
    when unique_violation then raise exception 'NAME_TAKEN' using errcode='23505';
    when check_violation then raise exception 'TEMPLATE_INVALID' using errcode='23514';
  end;
  insert into public.audit_logs(user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'crm.template.saved', 'crm_message_template', v.id::text, jsonb_build_object('name', v.name, 'channel', v.channel, 'active', v.active));
  return v;
end;
$function$;

revoke all on function public.crm_template_save(uuid, text, text, text, text[], text, text, text, text, boolean, text, text, jsonb) from public, anon;
grant execute on function public.crm_template_save(uuid, text, text, text, text[], text, text, text, text, boolean, text, text, jsonb) to authenticated;
