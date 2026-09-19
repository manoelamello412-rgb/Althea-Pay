create or replace function public.get_public_checkout_context(p_funnel_id text, p_offer_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare f record; o record; p record;
begin
  if p_funnel_id is null or length(trim(p_funnel_id)) < 1 or length(trim(p_funnel_id)) > 200 then raise exception 'INVALID_FUNNEL_ID' using errcode='22023'; end if;
  select f0.id,f0.nome,f0.organization_id,f0.user_id,f0.status,f0.deleted_at into f from public.funnels f0 where f0.id=trim(p_funnel_id) and f0.deleted_at is null limit 1;
  if not found or coalesce(lower(f.status),'active') not in ('active','published','live') then raise exception 'CHECKOUT_NOT_AVAILABLE' using errcode='22023'; end if;
  if p_offer_id is not null then
    select fo.id,fo.name,fo.price,fo.currency,fo.status,fo.product_id,fo.offer_type into o from public.funnel_offers fo where fo.id=p_offer_id and fo.funnel_id=f.id and fo.organization_id=f.organization_id and lower(fo.status) in ('active','published','live') limit 1;
  else
    select fo.id,fo.name,fo.price,fo.currency,fo.status,fo.product_id,fo.offer_type into o from public.funnel_offers fo where fo.funnel_id=f.id and fo.organization_id=f.organization_id and lower(fo.status) in ('active','published','live') and lower(fo.offer_type) in ('primary','main') order by fo.created_at asc limit 1;
  end if;
  if not found then raise exception 'CHECKOUT_OFFER_NOT_FOUND' using errcode='22023'; end if;
  select p0.id,p0.name,p0.description,p0.product_type,p0.billing_type,p0.billing_interval,p0.interval_count,p0.unit_amount,p0.currency into p from public.products p0 where p0.id=o.product_id and p0.organization_id=f.organization_id and p0.deleted_at is null and lower(p0.status)='active' limit 1;
  if not found then raise exception 'CHECKOUT_PRODUCT_NOT_FOUND' using errcode='22023'; end if;
  return jsonb_build_object('funnel',jsonb_build_object('id',f.id,'name',f.nome),'offer',jsonb_build_object('id',o.id,'name',o.name,'price',o.price,'currency',o.currency,'product_id',o.product_id,'type',o.offer_type),'product',jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'product_type',p.product_type,'billing_type',p.billing_type,'billing_interval',p.billing_interval,'interval_count',p.interval_count,'unit_amount',p.unit_amount,'currency',p.currency));
end;
$function$;