create or replace function public.complete_gateway_payment_link(p_link_id uuid,p_user_id uuid,p_status text,p_external_id text default null,p_payment_url text default null,p_pix_copy_paste text default null,p_qr_code_base64 text default null,p_expires_at timestamptz default null,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare v public.gateway_payment_links%rowtype;
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'forbidden'; end if;
 select * into v from public.gateway_payment_links where id=p_link_id and user_id=p_user_id for update;
 if not found then raise exception 'payment_link_not_found'; end if;
 update public.gateway_payment_links set status=p_status,external_id=coalesce(p_external_id,external_id),payment_url=coalesce(p_payment_url,payment_url),pix_copy_paste=coalesce(p_pix_copy_paste,pix_copy_paste),qr_code_base64=coalesce(p_qr_code_base64,qr_code_base64),expires_at=coalesce(p_expires_at,expires_at),metadata=coalesce(p_metadata,'{}'::jsonb),updated_at=now() where id=v.id;
 insert into public.gateway_operator_events(user_id,funnel_id,checkout_id,transaction_id,event_type,idempotency_key,payload) values(v.user_id,v.funnel_id,v.checkout_id,v.transaction_id,'payment.link_updated','payment-link:'||v.id::text||':'||p_status,jsonb_build_object('link_id',v.id,'status',p_status,'payment_url',p_payment_url,'pix_copy_paste',p_pix_copy_paste,'external_id',p_external_id)) on conflict do nothing;
 return jsonb_build_object('link_id',v.id,'status',p_status,'payment_url',p_payment_url,'pix_copy_paste',p_pix_copy_paste,'external_id',p_external_id,'expires_at',p_expires_at);
end $$;
revoke all on function public.complete_gateway_payment_link(uuid,uuid,text,text,text,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.complete_gateway_payment_link(uuid,uuid,text,text,text,text,text,timestamptz,jsonb) to service_role;
