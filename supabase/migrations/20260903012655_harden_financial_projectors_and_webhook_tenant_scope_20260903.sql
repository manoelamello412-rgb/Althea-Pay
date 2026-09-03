create or replace function public.project_funnel_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  e public.integration_events%rowtype;
  p jsonb;
  v_session text;
  v_checkout uuid;
  v_tx uuid;
  v_sale text;
  v_transitioned public.gateway_transactions;
begin
  select * into e from public.integration_events where id=p_event_id for update;
  if not found then return jsonb_build_object('ok',false,'error','event_not_found'); end if;
  p=coalesce(e.payload,'{}'::jsonb);
  if e.event_type='page_view' then
    v_session=coalesce(nullif(p->>'session_key',''),nullif(p->>'session_id',''));
    if v_session is not null then
      insert into public.attribution_sessions(user_id,funnel_id,session_key,source,medium,campaign,content,term,click_id,landing_url,first_seen_at,last_seen_at,metadata)
      values(e.user_id,e.funnel_id,v_session,p->>'source',p->>'medium',p->>'campaign',p->>'content',p->>'term',p->>'click_id',p->>'landing_url',coalesce(e.occurred_at,now()),coalesce(e.occurred_at,now()),coalesce(p->'metadata','{}'::jsonb)) on conflict do nothing;
    end if;
  elsif e.event_type in ('checkout_started','checkout_abandoned') then
    if nullif(p->>'checkout_id','') is not null then
      v_checkout=(p->>'checkout_id')::uuid;
      update public.checkout_sessions set status=case when e.event_type='checkout_abandoned' then 'abandoned' else 'pending' end, abandoned_at=case when e.event_type='checkout_abandoned' then coalesce(abandoned_at,e.occurred_at,now()) else abandoned_at end, updated_at=now() where id=v_checkout and user_id=e.user_id;
    end if;
  elsif e.event_type in ('purchase','upsell') then
    if nullif(p->>'transaction_id','') is not null then
      v_tx=(p->>'transaction_id')::uuid;
      select * into v_transitioned from public.transition_gateway_transaction_status(v_tx,e.user_id,'approved',nullif(p->>'failure_code',''),nullif(p->>'external_id',''));
    end if;
    v_sale=coalesce(nullif(p->>'sale_id',''),nullif(p->>'external_id',''),e.external_id,'sale_'||e.id::text);
    if v_tx is not null then
      insert into public.sales(id,user_id,funnel_id,product_id,checkout_id,transaction_id,amount,currency,status,attribution,source,medium,campaign,content,term,click_id,external_id,gateway_id,occurred_at,data)
      values(v_sale,e.user_id,e.funnel_id,nullif(p->>'product_id',''),v_checkout,v_tx,coalesce((p->>'amount')::numeric,0),coalesce(nullif(p->>'currency',''),'BRL'),'approved',coalesce(p->'attribution','{}'::jsonb),p->>'source',p->>'medium',p->>'campaign',p->>'content',p->>'term',p->>'click_id',e.external_id,p->>'gateway_id',coalesce(e.occurred_at,now()),p)
      on conflict (user_id, transaction_id) where transaction_id is not null do update set status='approved',amount=excluded.amount,checkout_id=coalesce(excluded.checkout_id,public.sales.checkout_id),occurred_at=excluded.occurred_at,data=excluded.data,external_id=coalesce(excluded.external_id,public.sales.external_id),gateway_id=coalesce(excluded.gateway_id,public.sales.gateway_id);
    else
      insert into public.sales(id,user_id,funnel_id,product_id,checkout_id,transaction_id,amount,currency,status,attribution,source,medium,campaign,content,term,click_id,external_id,gateway_id,occurred_at,data)
      values(v_sale,e.user_id,e.funnel_id,nullif(p->>'product_id',''),v_checkout,null,coalesce((p->>'amount')::numeric,0),coalesce(nullif(p->>'currency',''),'BRL'),'approved',coalesce(p->'attribution','{}'::jsonb),p->>'source',p->>'medium',p->>'campaign',p->>'content',p->>'term',p->>'click_id',e.external_id,p->>'gateway_id',coalesce(e.occurred_at,now()),p)
      on conflict (id) do update set status='approved',amount=excluded.amount,occurred_at=excluded.occurred_at,data=excluded.data;
    end if;
  elsif e.event_type in ('refund','chargeback') then
    if nullif(p->>'transaction_id','') is not null then
      v_tx=(p->>'transaction_id')::uuid;
      select * into v_transitioned from public.transition_gateway_transaction_status(v_tx,e.user_id,case when e.event_type='chargeback' then 'chargeback' else 'refunded' end,null,nullif(p->>'external_id',''));
      update public.sales set status=case when e.event_type='chargeback' then 'chargeback' else 'refunded' end where transaction_id=v_tx and user_id=e.user_id;
    elsif e.external_id is not null then
      update public.sales set status=case when e.event_type='chargeback' then 'chargeback' else 'refunded' end where external_id=e.external_id and user_id=e.user_id;
    end if;
  end if;
  return jsonb_build_object('ok',true,'event_id',e.id,'event_type',e.event_type);
exception when others then
  return jsonb_build_object('ok',false,'error',sqlerrm);
end;
$function$;
revoke all on function public.project_funnel_event(uuid) from public, anon, authenticated;
grant execute on function public.project_funnel_event(uuid) to service_role;

create or replace function public.transition_gateway_transaction_status(p_transaction_id uuid,p_user_id uuid,p_next_status text,p_failure_code text default null,p_external_id text default null)
returns public.gateway_transactions
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_row public.gateway_transactions; v_current text; v_next text := lower(trim(coalesce(p_next_status,'')));
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  if v_next not in ('created','pending','approved','failed','refunded','chargeback') then raise exception 'invalid_status'; end if;
  select t.status into v_current from public.gateway_transactions t where t.id=p_transaction_id and t.user_id=p_user_id for update;
  if not found then raise exception 'transaction_not_found'; end if;
  if not (v_current=v_next or (v_current='created' and v_next in ('pending','approved','failed')) or (v_current='pending' and v_next in ('approved','failed','refunded','chargeback')) or (v_current='approved' and v_next in ('refunded','chargeback'))) then raise exception 'invalid_status_transition'; end if;
  update public.gateway_transactions t set status=v_next,failure_code=coalesce(nullif(p_failure_code,''),t.failure_code),external_id=coalesce(nullif(p_external_id,''),t.external_id),completed_at=case when v_next in ('approved','refunded','chargeback') then coalesce(t.completed_at,now()) else t.completed_at end,updated_at=now() where t.id=p_transaction_id and t.user_id=p_user_id returning t.* into v_row;
  return v_row;
end;
$function$;
revoke all on function public.transition_gateway_transaction_status(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.transition_gateway_transaction_status(uuid,uuid,text,text,text) to service_role;
