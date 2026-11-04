-- crm_conversations.customer_id é text; 20261102140000 comparava com uuid e quebrava todo insert de conversa nova
-- (webhook Infobip devolvia 500, mensagem recebida não entrava no chat) e o desbloqueio (uuid = text).
create or replace function private.crm_conversation_flag_blocked()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, private as $$
begin
  if private.crm_contact_is_blocked(new.organization_id, new.customer_whatsapp, new.buyer_email,
       case when new.customer_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then new.customer_id::uuid end) then
    new.blocked := true;
  end if;
  return new;
end $$;

create or replace function public.crm_contact_block(p_conversation_id uuid, p_block boolean default true, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare
  v_org uuid := private.current_organization_id();
  c public.crm_conversations;
  v_phone text; v_email text; n integer;
begin
  if v_org is null or not private.has_org_capability(v_org, 'can_reply_chats') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into c from public.crm_conversations where id = p_conversation_id and organization_id = v_org;
  if not found then raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002'; end if;
  v_phone := private.crm_phone_digits(c.customer_whatsapp);
  v_email := lower(nullif(btrim(c.buyer_email), ''));

  if p_block then
    if v_phone is not null then
      insert into public.crm_blocked_contacts (organization_id, phone_digits, display_name, reason, created_by)
      values (v_org, v_phone, c.buyer_name, left(p_reason, 500), auth.uid()) on conflict do nothing;
    end if;
    if v_email is not null then
      insert into public.crm_blocked_contacts (organization_id, email, display_name, reason, created_by)
      values (v_org, v_email, c.buyer_name, left(p_reason, 500), auth.uid()) on conflict do nothing;
    end if;
    if c.customer_id is not null then
      insert into public.crm_blocked_contacts (organization_id, customer_id, display_name, reason, created_by)
      values (v_org, c.customer_id, c.buyer_name, left(p_reason, 500), auth.uid()) on conflict do nothing;
    end if;
    if v_phone is null and v_email is null and c.customer_id is null then
      raise exception 'CONTACT_NOT_IDENTIFIED' using errcode = '22023';
    end if;
  else
    delete from public.crm_blocked_contacts b
     where b.organization_id = v_org
       and (b.phone_digits = v_phone or b.email = v_email or b.customer_id::text = c.customer_id);
  end if;

  update public.crm_conversations x
     set blocked = p_block, unread_count = case when p_block then 0 else x.unread_count end, updated_at = now()
   where x.organization_id = v_org
     and (x.id = c.id
       or (v_phone is not null and private.crm_phone_digits(x.customer_whatsapp) = v_phone)
       or (v_email is not null and lower(x.buyer_email) = v_email)
       or (c.customer_id is not null and x.customer_id = c.customer_id));
  get diagnostics n = row_count;

  insert into public.audit_logs (user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.user_id, auth.uid(), v_org, case when p_block then 'crm.contact.blocked' else 'crm.contact.unblocked' end,
          'crm_conversation', c.id::text, jsonb_build_object('conversations', n));
  return jsonb_build_object('blocked', p_block, 'conversations', n);
end $$;
