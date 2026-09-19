create or replace function public.update_product(p_product_id text, p_version bigint, p_name text, p_slug text, p_description text, p_product_type text, p_billing_type text, p_unit_amount numeric, p_currency text, p_billing_interval text, p_interval_count integer, p_sku text, p_metadata jsonb, p_status text default null)
returns public.products language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_org uuid; v_product public.products; v_requested_status text;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 select default_organization_id into v_org from public.profiles where id=auth.uid();
 if v_org is null then raise exception 'ORGANIZATION_REQUIRED' using errcode='42501'; end if;
 if not exists(select 1 from public.organization_members m where m.organization_id=v_org and m.user_id=auth.uid() and m.role in ('owner','admin','manager','operator','supervisor')) then raise exception 'PRODUCT_WRITE_FORBIDDEN' using errcode='42501'; end if;
 if length(trim(coalesce(p_name,''))) < 1 or length(trim(p_name)) > 160 then raise exception 'PRODUCT_NAME_INVALID'; end if;
 if p_unit_amount < 0 then raise exception 'PRODUCT_AMOUNT_INVALID'; end if;
 if p_currency !~ '^[A-Z]{3}$' then raise exception 'PRODUCT_CURRENCY_INVALID'; end if;
 if p_billing_type not in ('one_time','subscription','free') then raise exception 'PRODUCT_BILLING_TYPE_INVALID'; end if;
 if p_product_type is not null and p_product_type not in ('digital','physical','service','membership','course','subscription','other') then raise exception 'PRODUCT_TYPE_INVALID'; end if;
 if p_billing_type='subscription' and (p_billing_interval not in ('day','week','month','year') or coalesce(p_interval_count,0) <= 0) then raise exception 'PRODUCT_SUBSCRIPTION_INTERVAL_INVALID'; end if;
 if p_billing_type <> 'subscription' and (p_billing_interval is not null or p_interval_count is not null) then raise exception 'PRODUCT_INTERVAL_NOT_ALLOWED'; end if;
 if p_billing_type='free' and p_unit_amount <> 0 then raise exception 'PRODUCT_FREE_AMOUNT_INVALID'; end if;
 if p_status is not null and p_status not in ('draft','active','paused') then raise exception 'PRODUCT_STATUS_INVALID'; end if;
 select * into v_product from public.products where id=p_product_id and organization_id=v_org and deleted_at is null;
 if not found then raise exception 'PRODUCT_NOT_FOUND' using errcode='P0002'; end if;
 v_requested_status := coalesce(p_status,v_product.status);
 if v_requested_status <> v_product.status then raise exception 'PRODUCT_STATUS_CHANGE_REQUIRES_LIFECYCLE_RPC' using errcode='42501'; end if;
 update public.products set name=trim(p_name),slug=nullif(trim(p_slug),''),description=nullif(trim(p_description),''),product_type=p_product_type,billing_type=p_billing_type,unit_amount=p_unit_amount,currency=p_currency,billing_interval=p_billing_interval,interval_count=p_interval_count,sku=nullif(trim(p_sku),''),metadata=coalesce(p_metadata,'{}'::jsonb),version=version+1,updated_at=now() where id=p_product_id and organization_id=v_org and deleted_at is null and version=p_version returning * into v_product;
 if not found then raise exception 'PRODUCT_VERSION_CONFLICT' using errcode='40001'; end if;
 insert into public.audit_logs(user_id,actor_id,organization_id,action,resource_type,resource_id,metadata) values(auth.uid(),auth.uid(),v_org,'product.updated','product',v_product.id,jsonb_build_object('version',v_product.version)); return v_product;
exception when unique_violation then raise exception 'PRODUCT_SLUG_OR_SKU_ALREADY_EXISTS' using errcode='23505';
end $function$;
revoke all on function public.update_product(text,bigint,text,text,text,text,text,numeric,text,text,integer,text,jsonb,text) from public,anon;
grant execute on function public.update_product(text,bigint,text,text,text,text,text,numeric,text,text,integer,text,jsonb,text) to authenticated;