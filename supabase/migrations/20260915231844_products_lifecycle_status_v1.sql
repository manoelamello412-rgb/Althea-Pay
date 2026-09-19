create or replace function public.set_product_status(p_product_id text, p_version bigint, p_status text)
returns public.products
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare v_org uuid; v_product public.products;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 select default_organization_id into v_org from public.profiles where id=auth.uid();
 if v_org is null then raise exception 'ORGANIZATION_REQUIRED' using errcode='42501'; end if;
 if not exists(select 1 from public.organization_members m where m.organization_id=v_org and m.user_id=auth.uid() and m.role in ('owner','admin','manager')) then raise exception 'PRODUCT_STATUS_FORBIDDEN' using errcode='42501'; end if;
 if p_status not in ('draft','active','paused') then raise exception 'PRODUCT_STATUS_INVALID'; end if;
 update public.products set status=p_status, version=version+1, updated_at=now() where id=p_product_id and organization_id=v_org and deleted_at is null and version=p_version returning * into v_product;
 if not found then
   if exists(select 1 from public.products where id=p_product_id and organization_id=v_org and deleted_at is null) then raise exception 'PRODUCT_VERSION_CONFLICT' using errcode='40001'; else raise exception 'PRODUCT_NOT_FOUND' using errcode='P0002'; end if;
 end if;
 insert into public.audit_logs(user_id,actor_id,organization_id,action,resource_type,resource_id,metadata) values(auth.uid(),auth.uid(),v_org,'product.status_changed','product',v_product.id,jsonb_build_object('status',v_product.status,'version',v_product.version));
 return v_product;
end $function$;
revoke all on function public.set_product_status(text,bigint,text) from public, anon;
grant execute on function public.set_product_status(text,bigint,text) to authenticated;