create or replace function public.prepare_gateway_payment_link(p_user_id uuid,p_funnel_id text,p_amount numeric,p_currency text,p_link_type text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_gateway text; v_provider text; v_tx uuid; v_link uuid; v_env text:='production';
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'forbidden'; end if;
 if p_amount<=0 or p_currency !~ '^[A-Z]{3}$' then raise exception 'invalid_amount_currency'; end if;
 if p_link_type not in ('pix','card','payment_link') then raise exception 'invalid_link_type'; end if;
 select g.id,g.provider into v_gateway,v_provider from public.gateways g where g.user_id=p_user_id and g.status in ('connected','degraded') and g.environment=v_env and (g.capabilities->>'payment_links')::boolean is true order by g.id limit 1;
 if v_gateway is null then raise exception 'no_gateway_payment_link_capability'; end if;
 insert into public.gateway_transactions(user_id,funnel_id,gateway_id,idempotency_key,amount,currency,status,metadata,routing_metadata) values(p_user_id,p_funnel_id,v_gateway,p_idempotency_key,p_amount,p_currency,'created',jsonb_build_object('operation','manual_payment_link','link_type',p_link_type),jsonb_build_object('source','gateway-payment-link')) on conflict (user_id,gateway_id,external_id) where external_id is not null do nothing returning id into v_tx;
 insert into public.gateway_payment_links(user_id,funnel_id,transaction_id,gateway_id,provider,link_type,amount,currency,idempotency_key,metadata) values(p_user_id,p_funnel_id,v_tx,v_gateway,v_provider,p_link_type,p_amount,p_currency,p_idempotency_key,jsonb_build_object('status','adapter_pending')) returning id into v_link;
 return jsonb_build_object('link_id',v_link,'transaction_id',v_tx,'gateway_id',v_gateway,'provider',v_provider);
end $$;
revoke all on function public.prepare_gateway_payment_link(uuid,text,numeric,text,text,text) from public,anon,authenticated;
grant execute on function public.prepare_gateway_payment_link(uuid,text,numeric,text,text,text) to service_role;
