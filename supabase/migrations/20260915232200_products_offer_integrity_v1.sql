begin;

alter table public.funnel_offers drop constraint if exists funnel_offers_product_id_fkey;
alter table public.funnel_offers add constraint funnel_offers_product_id_fkey foreign key (product_id) references public.products(id) on update cascade on delete restrict;

create or replace function public.enforce_funnel_offer_product_tenant()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare v_funnel_org uuid; v_product_org uuid;
begin
 select organization_id into v_funnel_org from public.funnels where id=new.funnel_id;
 select organization_id into v_product_org from public.products where id=new.product_id and deleted_at is null;
 if v_funnel_org is null or v_product_org is null or v_funnel_org <> v_product_org then
   raise exception 'FUNNEL_OFFER_TENANT_MISMATCH' using errcode='42501';
 end if;
 new.organization_id := v_funnel_org;
 return new;
end $function$;

drop trigger if exists trg_enforce_funnel_offer_product_tenant on public.funnel_offers;
create trigger trg_enforce_funnel_offer_product_tenant before insert or update of funnel_id, product_id, organization_id on public.funnel_offers for each row execute function public.enforce_funnel_offer_product_tenant();

revoke all on function public.enforce_funnel_offer_product_tenant() from public, anon, authenticated;
commit;
