
do $$
declare
  v_definition text;
begin
  select regexp_replace(pg_get_viewdef('public.v_funnel_operational_timeline'::regclass, true), ';\s*$', '')
    into v_definition;

  if v_definition is null or length(v_definition)=0 then
    raise exception 'operational_timeline_definition_missing';
  end if;

  execute
    'create or replace view public.v_funnel_operational_timeline
       with (security_invoker=true)
     as ' || v_definition || $view$
     union all
     select
       'crm_message:'||m.id::text as event_id,
       f.organization_id,
       m.user_id,
       c.funnel_id,
       'crm_message'::text as source,
       'chat'::text as category,
       case when m.direction='inbound' then 'chat_message_received' else 'chat_message_sent' end::text as event_type,
       case
         when m.direction='inbound' then 'received'
         when m.delivered_at is not null then 'sent'
         else coalesce(nullif(m.metadata->>'delivery_status',''),'queued')
       end::text as status,
       case
         when coalesce(m.metadata->>'delivery_status','') in ('dead_letter','failed','error') then 'error'
         when m.direction='outbound'
              and m.delivered_at is null
              and coalesce(m.metadata->>'delivery_status','queued') in ('queued','processing','retry_scheduled','retry')
           then 'warning'
         when m.direction='outbound' and m.delivered_at is not null then 'success'
         else 'info'
       end::text as severity,
       null::numeric as amount,
       null::text as currency,
       nullif(m.metadata->>'checkout_id','')::text as checkout_id,
       nullif(m.metadata->>'transaction_id','')::text as transaction_id,
       null::text as gateway_id,
       m.external_message_id as external_id,
       case
         when coalesce(m.metadata->>'delivery_status','') in ('dead_letter','failed','error')
           then coalesce(nullif(m.metadata->>'delivery_error',''),'Falha ao entregar mensagem no chat do funil.')
         else left(m.body,500)
       end::text as message,
       coalesce(m.metadata,'{}'::jsonb)
         || jsonb_build_object(
              'conversation_id',c.id,
              'direction',m.direction,
              'provider',m.provider,
              'remote_conversation_id',c.metadata->>'remote_conversation_id',
              'delivery_mode',c.metadata->>'delivery_mode',
              'delivered_at',m.delivered_at
            ) as metadata,
       m.created_at as occurred_at
     from public.crm_messages m
     join public.crm_conversations c
       on c.id=m.conversation_id
      and c.user_id=m.user_id
     join public.funnels f
       on f.id=c.funnel_id
      and f.user_id=m.user_id
     where c.funnel_id is not null
       and m.channel='funnel_chat'
     $view$;
end $$;

grant select on public.v_funnel_operational_timeline to authenticated;
revoke all on public.v_funnel_operational_timeline from anon;
