-- Transfer receipt upload in the funnel chat.
-- The buyer uploads through /api/funnel/chat/attachment (server, service role). Files live in a private
-- bucket under <organization_id>/<conversation_id>/; the message keeps only a reference in metadata.attachment.
-- A receipt exposes amounts and documents, so opening it requires can_view_chats AND can_view_values.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-attachments', 'chat-attachments', false, 4194304, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists chat_attachments_org_read on storage.objects;
create policy chat_attachments_org_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and private.has_org_capability(((storage.foldername(name))[1])::uuid, 'can_view_chats')
    and private.has_org_capability(((storage.foldername(name))[1])::uuid, 'can_view_values')
  );

create or replace function public.crm_public_attachment_target(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_conversation public.crm_conversations%rowtype;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 128 then
    return jsonb_build_object('error','invalid_token');
  end if;
  select * into v_conversation from public.crm_conversations where public_token = p_token limit 1;
  if v_conversation.id is null then return jsonb_build_object('error','not_found'); end if;
  if v_conversation.status = 'closed' then return jsonb_build_object('error','conversation_closed'); end if;
  return jsonb_build_object('conversation_id', v_conversation.id, 'organization_id', v_conversation.organization_id);
end;
$function$;

create or replace function public.crm_public_attachment_message(
  p_token text,
  p_path text,
  p_mime_type text,
  p_size_bytes integer,
  p_file_name text,
  p_caption text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_conversation public.crm_conversations%rowtype;
  v_message_id uuid;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 128 then
    return jsonb_build_object('error','invalid_token');
  end if;
  if p_mime_type is null or p_mime_type not in ('image/jpeg','image/png','image/webp','application/pdf') then
    return jsonb_build_object('error','invalid_file_type');
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 4194304 then
    return jsonb_build_object('error','invalid_file_size');
  end if;
  if p_caption is not null and length(p_caption) > 1000 then
    return jsonb_build_object('error','invalid_message');
  end if;

  select * into v_conversation from public.crm_conversations where public_token = p_token limit 1 for update;
  if v_conversation.id is null then return jsonb_build_object('error','not_found'); end if;
  if v_conversation.status = 'closed' then return jsonb_build_object('error','conversation_closed'); end if;
  -- The server picks the path, but never trust it: it must sit inside this conversation's folder.
  if p_path is null or p_path not like v_conversation.organization_id::text || '/' || v_conversation.id::text || '/%' then
    return jsonb_build_object('error','invalid_attachment_path');
  end if;

  insert into public.crm_messages(conversation_id,user_id,direction,channel,body,metadata,created_at)
  values(
    v_conversation.id, v_conversation.user_id, 'inbound', 'webchat',
    coalesce(nullif(btrim(p_caption),''), 'Comprovante de transferência enviado.'),
    jsonb_build_object(
      'source','funnel_public_chat',
      'attachment', jsonb_strip_nulls(jsonb_build_object(
        'kind','transfer_receipt',
        'bucket','chat-attachments',
        'path',p_path,
        'mime_type',p_mime_type,
        'size_bytes',p_size_bytes,
        'file_name',left(nullif(btrim(p_file_name),''),200),
        'transaction_id',v_conversation.transaction_id
      ))
    ),
    timezone('utc',now())
  )
  returning id into v_message_id;

  return jsonb_build_object('accepted',true,'message_id',v_message_id);
end;
$function$;

revoke all on function public.crm_public_attachment_target(text) from public, anon, authenticated;
revoke all on function public.crm_public_attachment_message(text,text,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.crm_public_attachment_target(text) to service_role;
grant execute on function public.crm_public_attachment_message(text,text,text,integer,text,text) to service_role;

-- Same contract as before, plus the buyer's own attachment name/type (never the storage path).
CREATE OR REPLACE FUNCTION public.crm_public_conversation(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare c jsonb; m jsonb; begin if p_token is null or length(p_token)<32 or length(p_token)>128 then return jsonb_build_object('error','invalid_token'); end if; select jsonb_build_object('id',x.id,'funnel_id',x.funnel_id,'product_id',x.product_id,'buyer_name',x.buyer_name,'buyer_email',x.buyer_email,'status',x.status,'updated_at',x.updated_at) into c from public.crm_conversations x where x.public_token=p_token limit 1; if c is null then return jsonb_build_object('error','not_found'); end if; select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',q.id,'direction',q.direction,'channel',q.channel,'body',q.body,'created_at',q.created_at,'attachment',case when q.metadata ? 'attachment' then jsonb_strip_nulls(jsonb_build_object('kind',q.metadata->'attachment'->>'kind','file_name',q.metadata->'attachment'->>'file_name','mime_type',q.metadata->'attachment'->>'mime_type')) end)) order by q.created_at asc),'[]'::jsonb) into m from (select x.id,x.direction,x.channel,x.body,x.created_at,x.metadata from public.crm_messages x join public.crm_conversations c2 on c2.id=x.conversation_id where c2.public_token=p_token and x.channel <> 'internal' order by x.created_at desc limit 200) q; return jsonb_build_object('conversation',c,'messages',coalesce(m,'[]'::jsonb)); end; $function$;
