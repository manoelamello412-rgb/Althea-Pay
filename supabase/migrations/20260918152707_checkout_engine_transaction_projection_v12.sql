create or replace function public.project_checkout_engine_transaction_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_metadata jsonb := coalesce(new.metadata,'{}'::jsonb);
  v_attribution jsonb := coalesce(v_metadata->'attribution','{}'::jsonb);
  v_checkout_id uuid;
  v_sale_id text := 'gateway_tx_' || new.id::text;
  v_event_type text;
  v_event_key text;
begin
  if coalesce(v_metadata->>'source','') <> 'checkout-engine-v2' then
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if nullif(v_metadata->>'checkout_id','') is not null
     and (v_metadata->>'checkout_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_checkout_id := (v_metadata->>'checkout_id')::uuid;
  end if;

  if new.status='approved' then
    if v_checkout_id is not null then
      update public.checkout_sessions
         set status='completed',
             completed_at=coalesce(completed_at,now()),
             abandoned_at=null,
             updated_at=now()
       where id=v_checkout_id
         and user_id=new.user_id
         and organization_id=new.organization_id
         and funnel_id=new.funnel_id;
    end if;

    insert into public.sales(
      id,user_id,organization_id,funnel_id,product_id,checkout_id,transaction_id,
      amount,currency,status,attribution,source,medium,campaign,content,term,click_id,
      external_id,gateway_id,occurred_at,data
    )
    values(
      v_sale_id,new.user_id,new.organization_id,new.funnel_id,new.product_id,v_checkout_id,new.id,
      new.amount,upper(new.currency),'approved',v_attribution,
      nullif(v_attribution->>'source',''),nullif(v_attribution->>'medium',''),nullif(v_attribution->>'campaign',''),
      nullif(v_attribution->>'content',''),nullif(v_attribution->>'term',''),nullif(v_attribution->>'click_id',''),
      new.external_id,new.gateway_id,coalesce(new.completed_at,now()),
      jsonb_build_object(
        'source','checkout-engine-v2',
        'transaction_id',new.id,
        'checkout_id',v_checkout_id,
        'customer',coalesce(new.customer,'{}'::jsonb),
        'transaction_metadata',v_metadata
      )
    )
    on conflict (user_id,transaction_id) where transaction_id is not null do update set
      organization_id=excluded.organization_id,
      funnel_id=excluded.funnel_id,
      product_id=coalesce(excluded.product_id,public.sales.product_id),
      checkout_id=coalesce(excluded.checkout_id,public.sales.checkout_id),
      amount=excluded.amount,
      currency=excluded.currency,
      status='approved',
      attribution=case when excluded.attribution <> '{}'::jsonb then excluded.attribution else public.sales.attribution end,
      source=coalesce(excluded.source,public.sales.source),
      medium=coalesce(excluded.medium,public.sales.medium),
      campaign=coalesce(excluded.campaign,public.sales.campaign),
      content=coalesce(excluded.content,public.sales.content),
      term=coalesce(excluded.term,public.sales.term),
      click_id=coalesce(excluded.click_id,public.sales.click_id),
      external_id=coalesce(excluded.external_id,public.sales.external_id),
      gateway_id=coalesce(excluded.gateway_id,public.sales.gateway_id),
      occurred_at=coalesce(excluded.occurred_at,public.sales.occurred_at),
      data=coalesce(public.sales.data,'{}'::jsonb)||excluded.data;

    perform public.materialize_gateway_customer_identity(new.id);
    perform public.project_sale_attribution(v_sale_id);

  elsif new.status in ('pending','created') then
    if v_checkout_id is not null then
      update public.checkout_sessions
         set status='processing',
             updated_at=now()
       where id=v_checkout_id
         and user_id=new.user_id
         and organization_id=new.organization_id
         and funnel_id=new.funnel_id
         and status in ('started','pending','processing');
    end if;

  elsif new.status='failed' then
    if v_checkout_id is not null then
      update public.checkout_sessions
         set status='failed',
             updated_at=now()
       where id=v_checkout_id
         and user_id=new.user_id
         and organization_id=new.organization_id
         and funnel_id=new.funnel_id
         and status <> 'completed';
    end if;

  elsif new.status in ('refunded','chargeback') then
    update public.sales
       set status=new.status,
           data=coalesce(data,'{}'::jsonb)||jsonb_build_object(
             'transaction_status',new.status,
             'updated_from_gateway_transaction',true
           ),
           occurred_at=coalesce(new.completed_at,occurred_at,now())
     where user_id=new.user_id
       and organization_id=new.organization_id
       and transaction_id=new.id;
  end if;

  v_event_type := case new.status
    when 'approved' then 'payment_approved'
    when 'failed' then 'payment_failed'
    when 'refunded' then 'refund'
    when 'chargeback' then 'chargeback'
    else 'payment_created'
  end;
  v_event_key := 'gateway_tx:'||new.id::text||':'||new.status;

  if v_checkout_id is not null then
    insert into public.checkout_events(
      user_id,organization_id,checkout_id,event_type,external_id,payload
    )
    values(
      new.user_id,new.organization_id,v_checkout_id,v_event_type,v_event_key,
      jsonb_build_object(
        'transaction_id',new.id,
        'gateway_id',new.gateway_id,
        'external_transaction_id',new.external_id,
        'status',new.status,
        'source','checkout-engine-v2'
      )
    )
    on conflict (user_id,external_id) do nothing;
  end if;

  insert into public.integration_events(
    user_id,organization_id,funnel_id,event_type,event_key,external_id,status,payload,occurred_at
  )
  values(
    new.user_id,new.organization_id,new.funnel_id,v_event_type,v_event_key,v_event_key,'pending',
    jsonb_build_object(
      'checkout_id',v_checkout_id,
      'transaction_id',new.id,
      'gateway_id',new.gateway_id,
      'provider_external_id',new.external_id,
      'amount',new.amount,
      'currency',new.currency,
      'product_id',new.product_id,
      'status',new.status,
      'source','checkout-engine-v2'
    ),
    coalesce(new.completed_at,new.updated_at,now())
  )
  on conflict (event_key) where event_key is not null do nothing;

  return new;
end;
$$;

drop trigger if exists trg_project_checkout_engine_transaction_state on public.gateway_transactions;
create trigger trg_project_checkout_engine_transaction_state
after update of status on public.gateway_transactions
for each row
execute function public.project_checkout_engine_transaction_state();

revoke all on function public.project_checkout_engine_transaction_state()
from public,anon,authenticated,service_role;
