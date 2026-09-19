create or replace function public.crm_public_conversation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_conversation jsonb; v_messages jsonb;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 128 then return jsonb_build_object('error','invalid_token'); end if;
  select jsonb_build_object('id',c.id,'funnel_id',c.funnel_id,'product_id',c.product_id,'buyer_name',c.buyer_name,'buyer_email',c.buyer_email,'status',c.status,'updated_at',c.updated_at)
    into v_conversation from public.crm_conversations c where c.public_token=p_token limit 1;
  if v_conversation is null then return jsonb_build_object('error','not_found'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'direction',m.direction,'channel',m.channel,'body',m.body,'created_at',m.created_at) order by m.created_at asc),'[]'::jsonb)
    into v_messages from public.crm_messages m join public.crm_conversations c on c.id=m.conversation_id where c.public_token=p_token and m.direction in ('inbound','outbound','system') limit 200;
  return jsonb_build_object('conversation',v_conversation,'messages',coalesce(v_messages,'[]'::jsonb));
end;
$$;

create or replace function public.crm_public_message(p_token text,p_body text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_id uuid; v_uid uuid; v_status text;
begin
  if p_token is null or length(p_token)<32 or length(p_token)>128 then return jsonb_build_object('error','invalid_token'); end if;
  if p_body is null or length(trim(p_body))=0 or length(p_body)>4000 then return jsonb_build_object('error','invalid_message'); end if;
  select id,user_id,status into v_id,v_uid,v_status from public.crm_conversations where public_token=p_token limit 1;
  if v_id is null then return jsonb_build_object('error','not_found'); end if;
  if v_status='closed' then return jsonb_build_object('error','conversation_closed'); end if;
  insert into public.crm_messages(conversation_id,user_id,direction,channel,body,metadata,created_at) values(v_id,v_uid,'inbound','webchat',trim(p_body),jsonb_build_object('source','funnel_public_chat'),timezone('utc',now()));
  return jsonb_build_object('accepted',true);
end;
$$;

revoke all on function public.crm_public_conversation(text) from public,anon,authenticated;
grant execute on function public.crm_public_conversation(text) to anon,authenticated;
revoke all on function public.crm_public_message(text,text) from public,anon,authenticated;
grant execute on function public.crm_public_message(text,text) to anon,authenticated;