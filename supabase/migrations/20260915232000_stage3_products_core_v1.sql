alter table public.products
  add column if not exists name text,
  add column if not exists slug text,
  add column if not exists description text,
  add column if not exists product_type text,
  add column if not exists status text not null default 'draft',
  add column if not exists billing_type text not null default 'one_time',
  add column if not exists billing_interval text,
  add column if not exists interval_count integer,
  add column if not exists unit_amount numeric(20,2) not null default 0,
  add column if not exists currency text not null default 'BRL',
  add column if not exists sku text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists version bigint not null default 1,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

update public.products set organization_id = coalesce(organization_id, (select default_organization_id from public.profiles where id = products.user_id limit 1)) where organization_id is null;
alter table public.products alter column organization_id set not null;
alter table public.products alter column user_id set not null;

alter table public.products drop constraint if exists products_status_check;
alter table public.products add constraint products_status_check check (status in ('draft','active','paused','archived'));
alter table public.products drop constraint if exists products_billing_type_check;
alter table public.products add constraint products_billing_type_check check (billing_type in ('one_time','subscription','free'));
alter table public.products drop constraint if exists products_billing_interval_check;
alter table public.products add constraint products_billing_interval_check check (billing_interval is null or billing_interval in ('day','week','month','year'));
alter table public.products drop constraint if exists products_interval_count_check;
alter table public.products add constraint products_interval_count_check check (interval_count is null or interval_count > 0);
alter table public.products drop constraint if exists products_amount_check;
alter table public.products add constraint products_amount_check check (unit_amount >= 0);
alter table public.products drop constraint if exists products_currency_check;
alter table public.products add constraint products_currency_check check (currency ~ '^[A-Z]{3}$');
alter table public.products drop constraint if exists products_product_type_check;
alter table public.products add constraint products_product_type_check check (product_type is null or product_type in ('digital','physical','service','membership','course','subscription','other'));
alter table public.products drop constraint if exists products_version_check;
alter table public.products add constraint products_version_check check (version > 0);

create unique index if not exists products_organization_slug_uidx on public.products(organization_id, slug) where slug is not null and deleted_at is null;
create unique index if not exists products_organization_sku_uidx on public.products(organization_id, sku) where sku is not null and deleted_at is null;
create index if not exists products_organization_status_idx on public.products(organization_id, status, created_at desc);
create index if not exists products_user_idx on public.products(user_id, created_at desc);

create or replace function public.product_slugify(p_name text) returns text language sql immutable set search_path = pg_catalog, public as $$ select left(trim(both '-' from regexp_replace(lower(coalesce(p_name,'')), '[^a-z0-9]+', '-', 'g')), 80) $$;

create or replace function public.create_product(p_name text, p_slug text default null, p_description text default null, p_product_type text default 'digital', p_billing_type text default 'one_time', p_unit_amount numeric default 0, p_currency text default 'BRL', p_billing_interval text default null, p_interval_count integer default null, p_sku text default null, p_metadata jsonb default '{}'::jsonb) returns public.products language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_org uuid; v_product public.products; v_slug text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  select default_organization_id into v_org from public.profiles where id=auth.uid();
  if v_org is null then raise exception 'ORGANIZATION_REQUIRED' using errcode='42501'; end if;
  if not exists (select 1 from public.organization_members m where m.organization_id=v_org and m.user_id=auth.uid() and m.role in ('owner','admin','manager','operator','supervisor')) then raise exception 'PRODUCT_WRITE_FORBIDDEN' using errcode='42501'; end if;
  if length(trim(coalesce(p_name,''))) < 1 or length(trim(p_name)) > 160 then raise exception 'PRODUCT_NAME_INVALID'; end if;
  if p_unit_amount < 0 then raise exception 'PRODUCT_AMOUNT_INVALID'; end if;
  if p_currency !~ '^[A-Z]{3}$' then raise exception 'PRODUCT_CURRENCY_INVALID'; end if;
  if p_billing_type not in ('one_time','subscription','free') then raise exception 'PRODUCT_BILLING_TYPE_INVALID'; end if;
  if p_product_type is not null and p_product_type not in ('digital','physical','service','membership','course','subscription','other') then raise exception 'PRODUCT_TYPE_INVALID'; end if;
  if p_billing_interval is not null and p_billing_interval not in ('day','week','month','year') then raise exception 'PRODUCT_INTERVAL_INVALID'; end if;
  if p_interval_count is not null and p_interval_count <= 0 then raise exception 'PRODUCT_INTERVAL_COUNT_INVALID'; end if;
  v_slug := coalesce(nullif(trim(p_slug),''), public.product_slugify(p_name));
  if v_slug = '' then raise exception 'PRODUCT_SLUG_INVALID'; end if;
  insert into public.products(id,user_id,organization_id,name,slug,description,product_type,status,billing_type,billing_interval,interval_count,unit_amount,currency,sku,metadata,version,created_at,updated_at) values ('prod_'||replace(gen_random_uuid()::text,'-',''),auth.uid(),v_org,trim(p_name),v_slug,nullif(trim(p_description),''),p_product_type,'draft',p_billing_type,p_billing_interval,p_interval_count,p_unit_amount,p_currency,nullif(trim(p_sku),''),coalesce(p_metadata,'{}'::jsonb),1,now(),now()) returning * into v_product;
  insert into public.audit_logs(user_id,actor_id,organization_id,action,resource_type,resource_id,metadata) values(auth.uid(),auth.uid(),v_org,'product.created','product',v_product.id,jsonb_build_object('name',v_product.name,'slug',v_product.slug));
  return v_product;
exception when unique_violation then raise exception 'PRODUCT_SLUG_OR_SKU_ALREADY_EXISTS' using errcode='23505'; end $$;

create or replace function public.update_product(p_product_id text, p_version bigint, p_name text, p_slug text, p_description text, p_product_type text, p_billing_type text, p_unit_amount numeric, p_currency text, p_billing_interval text, p_interval_count integer, p_sku text, p_metadata jsonb, p_status text default null) returns public.products language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_org uuid; v_product public.products;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  select default_organization_id into v_org from public.profiles where id=auth.uid();
  if v_org is null then raise exception 'ORGANIZATION_REQUIRED' using errcode='42501'; end if;
  if not exists (select 1 from public.organization_members m where m.organization_id=v_org and m.user_id=auth.uid() and m.role in ('owner','admin','manager','operator','supervisor')) then raise exception 'PRODUCT_WRITE_FORBIDDEN' using errcode='42501'; end if;
  if length(trim(coalesce(p_name,''))) < 1 or length(trim(p_name)) > 160 then raise exception 'PRODUCT_NAME_INVALID'; end if;
  if p_unit_amount < 0 or p_currency !~ '^[A-Z]{3}$' then raise exception 'PRODUCT_PRICE_INVALID'; end if;
  update public.products set name=trim(p_name),slug=trim(p_slug),description=nullif(trim(p_description),''),product_type=p_product_type,billing_type=p_billing_type,unit_amount=p_unit_amount,currency=p_currency,billing_interval=p_billing_interval,interval_count=p_interval_count,sku=nullif(trim(p_sku),''),metadata=coalesce(p_metadata,'{}'::jsonb),status=coalesce(p_status,status),version=version+1,updated_at=now() where id=p_product_id and organization_id=v_org and deleted_at is null and version=p_version returning * into v_product;
  if not found then if exists(select 1 from public.products where id=p_product_id and organization_id=v_org and deleted_at is null) then raise exception 'PRODUCT_VERSION_CONFLICT' using errcode='40001'; else raise exception 'PRODUCT_NOT_FOUND' using errcode='P0002'; end if; end if;
  insert into public.audit_logs(user_id,actor_id,organization_id,action,resource_type,resource_id,metadata) values(auth.uid(),auth.uid(),v_org,'product.updated','product',v_product.id,jsonb_build_object('version',v_product.version)); return v_product;
exception when unique_violation then raise exception 'PRODUCT_SLUG_OR_SKU_ALREADY_EXISTS' using errcode='23505'; end $$;

create or replace function public.archive_product(p_product_id text, p_version bigint) returns public.products language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_org uuid; v_product public.products;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  select default_organization_id into v_org from public.profiles where id=auth.uid();
  if v_org is null then raise exception 'ORGANIZATION_REQUIRED' using errcode='42501'; end if;
  if not exists (select 1 from public.organization_members m where m.organization_id=v_org and m.user_id=auth.uid() and m.role in ('owner','admin','manager')) then raise exception 'PRODUCT_ARCHIVE_FORBIDDEN' using errcode='42501'; end if;
  update public.products set status='archived',deleted_at=now(),deleted_by=auth.uid(),version=version+1,updated_at=now() where id=p_product_id and organization_id=v_org and deleted_at is null and version=p_version returning * into v_product;
  if not found then raise exception 'PRODUCT_VERSION_CONFLICT' using errcode='40001'; end if;
  insert into public.audit_logs(user_id,actor_id,organization_id,action,resource_type,resource_id,metadata) values(auth.uid(),auth.uid(),v_org,'product.archived','product',v_product.id,jsonb_build_object('version',v_product.version)); return v_product;
end $$;

create or replace function public.restore_product(p_product_id text, p_version bigint) returns public.products language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_org uuid; v_product public.products;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  select default_organization_id into v_org from public.profiles where id=auth.uid();
  if v_org is null then raise exception 'ORGANIZATION_REQUIRED' using errcode='42501'; end if;
  if not exists (select 1 from public.organization_members m where m.organization_id=v_org and m.user_id=auth.uid() and m.role in ('owner','admin','manager')) then raise exception 'PRODUCT_RESTORE_FORBIDDEN' using errcode='42501'; end if;
  update public.products set status='draft',deleted_at=null,deleted_by=null,version=version+1,updated_at=now() where id=p_product_id and organization_id=v_org and version=p_version returning * into v_product;
  if not found then raise exception 'PRODUCT_VERSION_CONFLICT' using errcode='40001'; end if;
  insert into public.audit_logs(user_id,actor_id,organization_id,action,resource_type,resource_id,metadata) values(auth.uid(),auth.uid(),v_org,'product.restored','product',v_product.id,jsonb_build_object('version',v_product.version)); return v_product;
end $$;

revoke all on function public.create_product(text,text,text,text,text,numeric,text,text,integer,text,jsonb) from public, anon;
revoke all on function public.update_product(text,bigint,text,text,text,text,text,numeric,text,text,integer,text,jsonb,text) from public, anon;
revoke all on function public.archive_product(text,bigint) from public, anon;
revoke all on function public.restore_product(text,bigint) from public, anon;
grant execute on function public.create_product(text,text,text,text,text,numeric,text,text,integer,text,jsonb) to authenticated;
grant execute on function public.update_product(text,bigint,text,text,text,text,text,numeric,text,text,integer,text,jsonb,text) to authenticated;
grant execute on function public.archive_product(text,bigint) to authenticated;
grant execute on function public.restore_product(text,bigint) to authenticated;

drop policy if exists products_select_tenant on public.products;
drop policy if exists products_insert_tenant on public.products;
drop policy if exists products_update_tenant on public.products;
drop policy if exists products_delete_tenant on public.products;
create policy products_select_tenant on public.products for select to authenticated using (exists(select 1 from public.organization_members m where m.organization_id=products.organization_id and m.user_id=auth.uid()) and deleted_at is null);
create policy products_insert_tenant on public.products for insert to authenticated with check (user_id=auth.uid() and exists(select 1 from public.organization_members m where m.organization_id=products.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin','manager','operator','supervisor')));
create policy products_update_tenant on public.products for update to authenticated using (exists(select 1 from public.organization_members m where m.organization_id=products.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin','manager','operator','supervisor'))) with check (organization_id=products.organization_id and user_id=products.user_id);
create policy products_delete_tenant on public.products for delete to authenticated using (false);
revoke all on public.products from anon;
grant select on public.products to authenticated;