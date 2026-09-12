create or replace function public.materialize_payment_link_customer_identity()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  v_customer jsonb := coalesce(new.customer,'{}'::jsonb);
  v_email text := lower(nullif(btrim(coalesce(v_customer->>'email',v_customer->>'buyer_email',v_customer->>'customer_email','')),''));
  v_name text := nullif(btrim(coalesce(v_customer->>'name',v_customer->>'full_name',v_customer->>'buyer_name',v_customer->>'customer_name','')),'');
  v_client public.clients%rowtype;
  v_data jsonb;
begin
  if coalesce(new.metadata->>'operation','') <> 'manual_payment_link' or new.status <> 'approved' then
    return new;
  end if;
  if v_email is null then return new; end if;

  select * into v_client
    from public.clients
   where user_id=new.user_id
     and lower(coalesce(data->>'email',data->>'buyer_email',data->>'customer_email',''))=v_email
   order by created_at asc
   limit 1
   for update;

  v_data := coalesce(v_client.data,'{}'::jsonb)
    || v_customer
    || jsonb_build_object('email',v_email,'last_transaction_id',new.id,'last_funnel_id',new.funnel_id,'last_gateway_id',new.gateway_id,'last_purchase_at',coalesce(new.completed_at,now()));
  if v_name is not null then v_data := v_data || jsonb_build_object('name',v_name); end if;

  if v_client.id is null then
    insert into public.clients(user_id,data)
    values(new.user_id,v_data)
    returning * into v_client;
  else
    update public.clients set data=v_data where id=v_client.id and user_id=new.user_id;
  end if;

  update public.sales
     set data=coalesce(data,'{}'::jsonb)||jsonb_build_object('customer_id',v_client.id::text,'email',v_email)
   where user_id=new.user_id and transaction_id=new.id;

  update public.crm_conversations
     set customer_id=v_client.id
   where user_id=new.user_id and transaction_id=new.id and customer_id is null;

  return new;
end;
$function$;

drop trigger if exists trg_gateway_payment_link_customer_identity on public.gateway_transactions;
create trigger trg_gateway_payment_link_customer_identity
after update of status on public.gateway_transactions
for each row execute function public.materialize_payment_link_customer_identity();
