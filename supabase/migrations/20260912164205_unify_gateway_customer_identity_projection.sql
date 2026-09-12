create or replace function public.materialize_gateway_customer_identity(p_transaction_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_tx public.gateway_transactions%rowtype;
  v_checkout public.checkout_sessions%rowtype;
  v_customer jsonb := '{}'::jsonb;
  v_email text;
  v_name text;
  v_client public.clients%rowtype;
  v_data jsonb;
  v_checkout_id uuid;
begin
  select * into v_tx from public.gateway_transactions where id=p_transaction_id for update;
  if not found or v_tx.status <> 'approved' then return null; end if;

  v_customer := coalesce(v_tx.customer,'{}'::jsonb);
  v_email := lower(nullif(btrim(coalesce(v_customer->>'email',v_customer->>'buyer_email',v_customer->>'customer_email','')),''));
  v_name := nullif(btrim(coalesce(v_customer->>'name',v_customer->>'full_name',v_customer->>'buyer_name',v_customer->>'customer_name','')),'');

  if v_email is null then
    begin v_checkout_id := nullif(v_tx.metadata->>'checkout_id','')::uuid; exception when others then v_checkout_id := null; end;
    if v_checkout_id is not null then
      select * into v_checkout from public.checkout_sessions where id=v_checkout_id and user_id=v_tx.user_id;
      if found then
        v_customer := coalesce(v_checkout.customer,'{}'::jsonb) || v_customer;
        v_email := lower(nullif(btrim(coalesce(v_customer->>'email',v_customer->>'buyer_email',v_customer->>'customer_email','')),''));
        v_name := nullif(btrim(coalesce(v_customer->>'name',v_customer->>'full_name',v_customer->>'buyer_name',v_customer->>'customer_name','')),'');
      end if;
    end if;
  end if;

  if v_email is null then return null; end if;

  select * into v_client
    from public.clients
   where user_id=v_tx.user_id
     and lower(coalesce(data->>'email',data->>'buyer_email',data->>'customer_email',''))=v_email
   order by created_at asc limit 1 for update;

  v_data := coalesce(v_client.data,'{}'::jsonb) || v_customer || jsonb_build_object('email',v_email,'last_transaction_id',v_tx.id,'last_funnel_id',v_tx.funnel_id,'last_gateway_id',v_tx.gateway_id,'last_purchase_at',coalesce(v_tx.completed_at,now()));
  if v_name is not null then v_data := v_data || jsonb_build_object('name',v_name); end if;

  if v_client.id is null then
    insert into public.clients(user_id,data) values(v_tx.user_id,v_data) returning * into v_client;
  else
    update public.clients set data=v_data where id=v_client.id and user_id=v_tx.user_id;
  end if;

  update public.sales set data=coalesce(data,'{}'::jsonb)||jsonb_build_object('customer_id',v_client.id::text,'email',v_email) where user_id=v_tx.user_id and transaction_id=v_tx.id;
  update public.crm_conversations set customer_id=v_client.id where user_id=v_tx.user_id and transaction_id=v_tx.id and customer_id is null;
  return v_client.id;
end;
$$;

drop trigger if exists trg_gateway_payment_link_customer_identity on public.gateway_transactions;
drop function if exists public.materialize_payment_link_customer_identity();

create or replace function public.project_checkout_purchase(p_checkout_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare c record; t record; sid text;
begin
  select * into c from public.checkout_sessions where id=p_checkout_id for update;
  if not found then raise exception 'checkout_not_found'; end if;
  select * into t from public.gateway_transactions where user_id=c.user_id and (metadata->>'checkout_id')=p_checkout_id::text order by created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'reason','transaction_not_found'); end if;
  if t.status <> 'approved' then return jsonb_build_object('ok',false,'reason','transaction_not_approved','status',t.status); end if;
  sid:=coalesce(t.external_id,p_checkout_id::text);
  insert into public.sales(id,user_id,funnel_id,product_id,checkout_id,transaction_id,amount,currency,status,attribution,source,medium,campaign,content,term,click_id,external_id,gateway_id,occurred_at,data)
  values(sid,c.user_id,c.funnel_id,c.product_id,c.id,t.id,t.amount,t.currency,'approved',c.attribution,c.attribution->>'source',c.attribution->>'medium',c.attribution->>'campaign',c.attribution->>'content',c.attribution->>'term',c.attribution->>'click_id',t.external_id,t.gateway_id,coalesce(t.completed_at,now()),jsonb_build_object('projected_by','project_checkout_purchase'))
  on conflict (id) do update set transaction_id=excluded.transaction_id,checkout_id=excluded.checkout_id,status=excluded.status,amount=excluded.amount,currency=excluded.currency,attribution=excluded.attribution,gateway_id=excluded.gateway_id,occurred_at=excluded.occurred_at;
  perform public.materialize_gateway_customer_identity(t.id);
  update public.checkout_sessions set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now() where id=c.id;
  return jsonb_build_object('ok',true,'sale_id',sid,'transaction_id',t.id,'checkout_id',c.id);
end;
$$;

create or replace function public.project_gateway_payment_link_sale()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','public'
as $$
declare
  v_metadata jsonb:=coalesce(new.metadata,'{}'::jsonb); v_link public.gateway_payment_links%rowtype; v_sale_id text:='gateway_tx_'||new.id::text; v_checkout_id uuid; v_product_id text; v_attribution jsonb:=coalesce(v_metadata->'attribution','{}'::jsonb);
begin
  if coalesce(v_metadata->>'operation','')<>'manual_payment_link' then return new; end if;
  select * into v_link from public.gateway_payment_links where transaction_id=new.id and user_id=new.user_id order by created_at desc limit 1;
  v_product_id:=nullif(v_metadata->>'product_id',''); if v_product_id is null then v_product_id:=nullif(v_link.metadata->>'product_id',''); end if;
  if coalesce(v_metadata->>'checkout_id',v_link.checkout_id::text) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then v_checkout_id:=coalesce(nullif(v_metadata->>'checkout_id','')::uuid,v_link.checkout_id); else v_checkout_id:=v_link.checkout_id; end if;
  if new.status='approved' and coalesce(old.status,'')<>'approved' then
    insert into public.sales(id,user_id,funnel_id,product_id,checkout_id,transaction_id,amount,currency,status,attribution,source,medium,campaign,content,term,click_id,external_id,gateway_id,occurred_at,data)
    values(v_sale_id,new.user_id,new.funnel_id,v_product_id,v_checkout_id,new.id,new.amount,upper(new.currency),'approved',v_attribution,nullif(v_attribution->>'source',''),nullif(v_attribution->>'medium',''),nullif(v_attribution->>'campaign',''),nullif(v_attribution->>'content',''),nullif(v_attribution->>'term',''),nullif(v_attribution->>'click_id',''),new.external_id,new.gateway_id,coalesce(new.completed_at,now()),jsonb_build_object('source','gateway_payment_link','transaction_id',new.id,'payment_link_id',nullif(v_link.id::text,''),'link_type',v_link.link_type,'customer',coalesce(new.customer,'{}'::jsonb),'transaction_metadata',v_metadata))
    on conflict (user_id,transaction_id) where transaction_id is not null do update set funnel_id=excluded.funnel_id,product_id=coalesce(excluded.product_id,public.sales.product_id),checkout_id=coalesce(excluded.checkout_id,public.sales.checkout_id),amount=excluded.amount,currency=excluded.currency,status='approved',attribution=case when excluded.attribution<>'{}'::jsonb then excluded.attribution else public.sales.attribution end,source=coalesce(excluded.source,public.sales.source),medium=coalesce(excluded.medium,public.sales.medium),campaign=coalesce(excluded.campaign,public.sales.campaign),content=coalesce(excluded.content,public.sales.content),term=coalesce(excluded.term,public.sales.term),click_id=coalesce(excluded.click_id,public.sales.click_id),external_id=coalesce(excluded.external_id,public.sales.external_id),gateway_id=coalesce(excluded.gateway_id,public.sales.gateway_id),occurred_at=coalesce(excluded.occurred_at,public.sales.occurred_at),data=coalesce(public.sales.data,'{}'::jsonb)||excluded.data;
    perform public.materialize_gateway_customer_identity(new.id);
    if v_link.id is not null then update public.gateway_payment_links set status=case when coalesce(status,'')='active' then 'paid' else status end,updated_at=now() where id=v_link.id and user_id=new.user_id; end if;
    perform public.project_sale_attribution(v_sale_id);
  elsif new.status in ('refunded','chargeback') and coalesce(old.status,'')<>new.status then
    update public.sales set status=new.status,data=coalesce(data,'{}'::jsonb)||jsonb_build_object('transaction_status',new.status,'updated_from_gateway_transaction',true),occurred_at=coalesce(new.completed_at,occurred_at,now()) where user_id=new.user_id and transaction_id=new.id;
  end if;
  return new;
end;
$$;

comment on function public.materialize_gateway_customer_identity(uuid) is 'Canonical customer identity projection for approved gateway transactions across checkout and payment-link flows.';
