create or replace function public.crm_mirror_client_event() returns trigger language plpgsql security definer set search_path=public as $$
declare v_payload jsonb; v_name text; v_email text; v_funnel_id text;
begin
  v_payload:=coalesce(new.data,'{}'::jsonb);
  v_name:=coalesce(v_payload->>'name',v_payload->>'nome',v_payload->>'full_name',v_payload->>'buyer_name',v_payload->>'customer_name');
  v_email:=coalesce(v_payload->>'email',v_payload->>'buyer_email',v_payload->>'customer_email');
  v_funnel_id:=coalesce(v_payload->>'funnel_id',v_payload->>'funnelId');
  insert into public.crm_webhook_events(user_id,idempotency_key,transaction_id,status,buyer_email,buyer_name,payload,received_at)
  values(new.user_id,'client:'||new.id||':'||coalesce(to_char(new.created_at,'YYYYMMDDHH24MISSMS'),'na'),'client.'||tg_op,v_email,v_name,v_payload||jsonb_build_object('client_id',new.id,'funnel_id',v_funnel_id),coalesce(new.created_at,timezone('utc',now())))
  on conflict (user_id,idempotency_key) where idempotency_key is not null do nothing;
  return new;
end;
$$;
drop trigger if exists trg_crm_mirror_client_event on public.clients;
create trigger trg_crm_mirror_client_event after insert or update on public.clients for each row execute function public.crm_mirror_client_event();

create or replace function public.crm_mirror_sale_event() returns trigger language plpgsql security definer set search_path=public as $$
declare v_payload jsonb; v_name text; v_email text; v_status text;
begin
  v_payload:=coalesce(new.data,'{}'::jsonb)||jsonb_build_object('sale_id',new.id,'funnel_id',new.funnel_id,'product_id',new.product_id,'checkout_id',new.checkout_id,'transaction_id',new.transaction_id,'amount',new.amount,'currency',new.currency,'status',new.status,'occurred_at',new.occurred_at);
  v_name:=coalesce(v_payload->>'buyer_name',v_payload->>'customer_name',v_payload->>'name',v_payload->>'nome',v_payload->>'full_name');
  v_email:=coalesce(v_payload->>'buyer_email',v_payload->>'customer_email',v_payload->>'email');
  v_status:=coalesce(new.status,'unknown');
  insert into public.crm_webhook_events(user_id,idempotency_key,transaction_id,status,buyer_email,buyer_name,payload,received_at)
  values(new.user_id,'sale:'||new.id||':'||v_status||':'||coalesce(to_char(new.occurred_at,'YYYYMMDDHH24MISSMS'),'na'),new.transaction_id::text,v_status,v_email,v_name,v_payload,coalesce(new.occurred_at,new.created_at,timezone('utc',now())))
  on conflict (user_id,idempotency_key) where idempotency_key is not null do nothing;
  return new;
end;
$$;
drop trigger if exists trg_crm_mirror_sale_event on public.sales;
create trigger trg_crm_mirror_sale_event after insert or update on public.sales for each row execute function public.crm_mirror_sale_event();
