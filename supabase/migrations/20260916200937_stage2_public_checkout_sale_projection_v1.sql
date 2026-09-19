create or replace function public.project_public_checkout_sale()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_metadata jsonb := coalesce(new.metadata,'{}'::jsonb);
  v_attribution jsonb := coalesce(v_metadata->'attribution','{}'::jsonb);
  v_checkout_id uuid;
  v_product_id text;
  v_sale_id text := 'gateway_tx_' || new.id::text;
begin
  if new.status='approved' and coalesce(old.status,'')<>'approved' and coalesce(v_metadata->>'source','')='public_checkout' then
    if nullif(v_metadata->>'checkout_session_id','') is not null and (v_metadata->>'checkout_session_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_checkout_id := (v_metadata->>'checkout_session_id')::uuid;
    end if;
    v_product_id := nullif(new.product_id,'');
    insert into public.sales(
      id,user_id,organization_id,funnel_id,product_id,checkout_id,transaction_id,amount,currency,status,
      attribution,source,medium,campaign,content,term,click_id,external_id,gateway_id,occurred_at,data
    ) values (
      v_sale_id,new.user_id,new.organization_id,new.funnel_id,v_product_id,v_checkout_id,new.id,new.amount,upper(new.currency),'approved',
      v_attribution,
      nullif(v_attribution->>'source',''),nullif(v_attribution->>'medium',''),nullif(v_attribution->>'campaign',''),
      nullif(v_attribution->>'content',''),nullif(v_attribution->>'term',''),nullif(v_attribution->>'click_id',''),
      new.external_id,new.gateway_id,coalesce(new.completed_at,now()),
      jsonb_build_object('source','public_checkout','transaction_id',new.id,'checkout_session_id',v_checkout_id,'customer',coalesce(new.customer,'{}'::jsonb),'transaction_metadata',v_metadata)
    )
    on conflict (user_id,transaction_id) where transaction_id is not null do update set
      organization_id=excluded.organization_id,funnel_id=excluded.funnel_id,product_id=coalesce(excluded.product_id,public.sales.product_id),
      checkout_id=coalesce(excluded.checkout_id,public.sales.checkout_id),amount=excluded.amount,currency=excluded.currency,status='approved',
      attribution=case when excluded.attribution <> '{}'::jsonb then excluded.attribution else public.sales.attribution end,
      source=coalesce(excluded.source,public.sales.source),medium=coalesce(excluded.medium,public.sales.medium),campaign=coalesce(excluded.campaign,public.sales.campaign),
      content=coalesce(excluded.content,public.sales.content),term=coalesce(excluded.term,public.sales.term),click_id=coalesce(excluded.click_id,public.sales.click_id),
      external_id=coalesce(excluded.external_id,public.sales.external_id),gateway_id=coalesce(excluded.gateway_id,public.sales.gateway_id),
      occurred_at=coalesce(excluded.occurred_at,public.sales.occurred_at),data=coalesce(public.sales.data,'{}'::jsonb)||excluded.data;
    perform public.materialize_gateway_customer_identity(new.id);
    perform public.project_sale_attribution(v_sale_id);
  elsif new.status in ('refunded','chargeback') and coalesce(old.status,'')<>new.status and coalesce(v_metadata->>'source','')='public_checkout' then
    update public.sales set status=new.status,data=coalesce(data,'{}'::jsonb)||jsonb_build_object('transaction_status',new.status,'updated_from_gateway_transaction',true),occurred_at=coalesce(new.completed_at,occurred_at,now()) where user_id=new.user_id and transaction_id=new.id;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_public_checkout_sale_projection on public.gateway_transactions;
create trigger trg_public_checkout_sale_projection
after update of status on public.gateway_transactions
for each row execute function public.project_public_checkout_sale();