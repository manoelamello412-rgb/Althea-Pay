create or replace function public.create_product(p_name text, p_slug text default null, p_description text default null, p_product_type text default 'digital', p_billing_type text default 'one_time', p_unit_amount numeric default 0, p_currency text default 'BRL', p_billing_interval text default null, p_interval_count integer default null, p_sku text default null, p_metadata jsonb default '{}'::jsonb)
returns public.products language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_org uuid; v_product public.products; v_slug text;
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
 v_slug := coalesce(nullif(trim(p_slug),''), public.product_slugify(p_name));
 if v_slug='' then raise exception 'PRODUCT_SLUG_INVALID'; end if;
 insert into public.products(id,user_id,organization_id,name,slug,description,product_type,status,billing_type,billing_interval,interval_count,unit_amount,currency,sku,metadata,version,created_at,updated_at) values ('prod_'||replace(gen_random_uuid()::text,'-',''),auth.uid(),v_org,trim(p_name),v_slug,nullif(trim(p_description),''),p_product_type,'draft',p_billing_type,p_billing_interval,p_interval_count,p_unit_amount,p_currency,nullif(trim(p_sku),''),coalesce(p_metadata,'{}'::jsonb),1,now(),now()) returning * into v_product;
 insert into public.audit_logs(user_id,actor_id,organization_id,action,resource_type,resource_id,metadata) values(auth.uid(),auth.uid(),v_org,'product.created','product',v_product.id,jsonb_build_object('name',v_product.name,'slug',v_product.slug)); return v_product;
exception when unique_violation then raise exception 'PRODUCT_SLUG_OR_SKU_ALREADY_EXISTS' using errcode='23505';
end $function$;
revoke all on function public.create_product(text,text,text,text,text,numeric,text,text,integer,text,jsonb) from public,anon;
grant execute on function public.create_product(text,text,text,text,text,numeric,text,text,integer,text,jsonb) to authenticated;