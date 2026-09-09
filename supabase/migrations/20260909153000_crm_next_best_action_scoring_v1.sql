create or replace function public.crm_next_best_actions(p_conversation_id uuid default null)
returns table(action_type text, priority integer, score numeric, rationale text, evidence jsonb)
language plpgsql security invoker set search_path=public
as $$
declare v_uid uuid := auth.uid(); r record;
begin
 if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
 if p_conversation_id is not null then
   select c.* into r from public.crm_conversations c where c.id=p_conversation_id and c.user_id=v_uid;
   if not found then raise exception 'CONVERSATION_NOT_FOUND'; end if;
   return query
   with stats as (
     select r.id conversation_id,
       coalesce((select count(*) from crm_messages m where m.conversation_id=r.id and m.user_id=v_uid and m.direction='inbound'),0)::int inbound_count,
       coalesce((select count(*) from crm_messages m where m.conversation_id=r.id and m.user_id=v_uid and m.direction='outbound'),0)::int outbound_count,
       coalesce((select sum(s.amount) from sales s where s.user_id=v_uid and ((r.transaction_id is not null and s.transaction_id=r.transaction_id) or (r.buyer_email is not null and lower(coalesce(s.data->>'email',s.data->>'buyer_email',s.data->>'customer_email',''))=lower(r.buyer_email)))),0)::numeric revenue,
       coalesce((select count(*) from crm_webhook_events e where e.user_id=v_uid and ((r.transaction_id is not null and e.transaction_id=r.transaction_id) or (r.buyer_email is not null and lower(coalesce(e.buyer_email,''))=lower(r.buyer_email)))),0)::int event_count
   )
   select 'respond'::text,100,greatest(0,least(100,60 + case when s.inbound_count>s.outbound_count then 30 else 0 end + case when r.last_inbound_at is not null and r.first_response_at is null then 10 else 0 end))::numeric,
     case when r.first_response_at is null and r.last_inbound_at is not null then 'Cliente aguarda primeira resposta.' when s.inbound_count>s.outbound_count then 'Há mensagens recebidas sem resposta correspondente.' else 'Manter acompanhamento ativo da conversa.' end,
     jsonb_build_object('inbound_count',s.inbound_count,'outbound_count',s.outbound_count,'last_inbound_at',r.last_inbound_at,'first_response_at',r.first_response_at)
   from stats s where r.status <> 'closed'
   union all
   select 'recover'::text,90,greatest(0,least(100,case when s.event_count>0 and s.revenue=0 then 85 else 20 end))::numeric,
     case when s.event_count>0 and s.revenue=0 then 'Existem eventos financeiros sem receita observada; avaliar recuperação.' else 'Sem sinal forte de recuperação financeira.' end,
     jsonb_build_object('event_count',s.event_count,'observed_revenue',s.revenue)
   from stats s where r.status <> 'closed' and s.event_count>0
   union all
   select 'upsell'::text,70,65::numeric,'Cliente possui receita observada; avaliar oferta complementar com base no histórico real.',jsonb_build_object('observed_revenue',s.revenue)
   from stats s where r.status <> 'closed' and s.revenue>0
   order by priority desc,score desc;
 else
   return query select 'queue_review'::text,80,80::numeric,'Revisar fila operacional priorizando SLA e conversas não respondidas.',jsonb_build_object('open_conversations',(select count(*) from crm_conversations c where c.user_id=v_uid and c.status<>'closed'));
 end if;
end; $$;
revoke all on function public.crm_next_best_actions(uuid) from public;
grant execute on function public.crm_next_best_actions(uuid) to authenticated;
create index if not exists crm_ai_actions_conversation_created_idx on public.crm_ai_actions(conversation_id,created_at desc);
