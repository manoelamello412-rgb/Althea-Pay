begin;

-- Canonical checkout child records inherit the tenant from their session.
alter table public.checkout_items add column if not exists organization_id uuid;
alter table public.checkout_events add column if not exists organization_id uuid;

update public.checkout_items i
set organization_id = s.organization_id
from public.checkout_sessions s
where i.checkout_id = s.id and i.organization_id is null;

update public.checkout_events e
set organization_id = s.organization_id
from public.checkout_sessions s
where e.checkout_id = s.id and e.organization_id is null;

alter table public.checkout_items alter column organization_id set not null;
alter table public.checkout_events alter column organization_id set not null;

create index if not exists checkout_items_organization_checkout_idx on public.checkout_items (organization_id, checkout_id);
create index if not exists checkout_events_organization_created_idx on public.checkout_events (organization_id, created_at desc);

alter table public.checkout_items drop constraint if exists checkout_items_checkout_fk;
alter table public.checkout_items add constraint checkout_items_checkout_fk foreign key (checkout_id) references public.checkout_sessions(id) on delete cascade;

alter table public.checkout_events drop constraint if exists checkout_events_checkout_fk;
alter table public.checkout_events add constraint checkout_events_checkout_fk foreign key (checkout_id) references public.checkout_sessions(id) on delete cascade;

-- Defensive invariants for money, currency and quantities.
alter table public.checkout_sessions drop constraint if exists checkout_sessions_amount_nonnegative;
alter table public.checkout_sessions add constraint checkout_sessions_amount_nonnegative check (amount >= 0);
alter table public.checkout_sessions drop constraint if exists checkout_sessions_currency_format;
alter table public.checkout_sessions add constraint checkout_sessions_currency_format check (currency ~ '^[A-Z]{3}$');
alter table public.checkout_items drop constraint if exists checkout_items_unit_amount_nonnegative;
alter table public.checkout_items add constraint checkout_items_unit_amount_nonnegative check (unit_amount >= 0);
alter table public.checkout_items drop constraint if exists checkout_items_quantity_positive;
alter table public.checkout_items add constraint checkout_items_quantity_positive check (quantity > 0);
alter table public.checkout_items drop constraint if exists checkout_items_kind_valid;
alter table public.checkout_items add constraint checkout_items_kind_valid check (kind in ('main','order_bump','upsell','downsell','other'));

-- Replace legacy user-only child policies with tenant-scoped authenticated read access.
drop policy if exists checkout_items_owner on public.checkout_items;
drop policy if exists checkout_events_owner on public.checkout_events;
drop policy if exists checkout_offers_owner on public.checkout_offers;

create policy checkout_items_org_select on public.checkout_items for select to authenticated using (private.is_org_member(organization_id));
create policy checkout_events_org_select on public.checkout_events for select to authenticated using (private.is_org_member(organization_id));

-- Public buyers never receive direct table access; public checkout is exposed only through RPCs below.
revoke all on table public.checkout_sessions from anon, authenticated;
revoke all on table public.checkout_items from anon, authenticated;
revoke all on table public.checkout_events from anon, authenticated;
revoke all on table public.checkout_offers from anon, authenticated;

create or replace function public.get_public_checkout_context(p_funnel_id text, p_offer_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  f record;
  o record;
  p record;
begin
  if p_funnel_id is null or length(trim(p_funnel_id)) < 1 or length(trim(p_funnel_id)) > 200 then
    raise exception 'INVALID_FUNNEL_ID' using errcode = '22023';
  end if;

  select f0.id, f0.nome, f0.organization_id, f0.user_id, f0.status, f0.deleted_at
    into f
    from public.funnels f0
   where f0.id = trim(p_funnel_id)
     and f0.deleted_at is null
   limit 1;

  if not found or coalesce(lower(f.status),'active') not in ('active','published','live') then
    raise exception 'CHECKOUT_NOT_AVAILABLE' using errcode = '22023';
  end if;

  if p_offer_id is not null then
    select fo.id, fo.name, fo.price, fo.currency, fo.status, fo.product_id, fo.offer_type
      into o
      from public.funnel_offers fo
     where fo.id = p_offer_id
       and fo.funnel_id = f.id
       and fo.organization_id = f.organization_id
       and lower(fo.status) in ('active','published','live')
     limit 1;
  else
    select fo.id, fo.name, fo.price, fo.currency, fo.status, fo.product_id, fo.offer_type
      into o
      from public.funnel_offers fo
     where fo.funnel_id = f.id
       and fo.organization_id = f.organization_id
       and lower(fo.status) in ('active','published','live')
       and lower(fo.offer_type) in ('primary','main')
     order by fo.created_at asc
     limit 1;
  end if;

  if not found then
    raise exception 'CHECKOUT_OFFER_NOT_FOUND' using errcode = '22023';
  end if;

  select p0.id,p0.name,p0.description,p0.product_type,p0.billing_type,p0.billing_interval,p0.interval_count,p0.unit_amount,p0.currency,p0.metadata
    into p
    from public.products p0
   where p0.id=o.product_id
     and p0.organization_id=f.organization_id
     and p0.deleted_at is null
     and lower(p0.status)='active'
   limit 1;

  if not found then
    raise exception 'CHECKOUT_PRODUCT_NOT_FOUND' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'funnel', jsonb_build_object('id',f.id,'name',f.nome),
    'offer', jsonb_build_object('id',o.id,'name',o.name,'price',o.price,'currency',o.currency,'product_id',o.product_id,'type',o.offer_type),
    'product', jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'product_type',p.product_type,'billing_type',p.billing_type,'billing_interval',p.billing_interval,'interval_count',p.interval_count,'unit_amount',p.unit_amount,'currency',p.currency,'metadata',p.metadata)
  );
end;
$function$;

create or replace function public.create_public_checkout_session(
  p_funnel_id text,
  p_offer_id uuid,
  p_customer jsonb default '{}'::jsonb,
  p_attribution jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  f record;
  o record;
  p record;
  v_existing public.checkout_sessions%rowtype;
  v_session public.checkout_sessions%rowtype;
  v_key text := nullif(trim(p_idempotency_key),'');
  v_customer jsonb := coalesce(p_customer,'{}'::jsonb);
  v_attribution jsonb := coalesce(p_attribution,'{}'::jsonb);
  v_metadata jsonb := coalesce(p_metadata,'{}'::jsonb);
  v_email text;
begin
  if p_funnel_id is null or length(trim(p_funnel_id)) < 1 or length(trim(p_funnel_id)) > 200 then raise exception 'INVALID_FUNNEL_ID' using errcode='22023'; end if;
  if p_offer_id is null then raise exception 'OFFER_REQUIRED' using errcode='22023'; end if;
  if v_key is null or length(v_key) < 16 or length(v_key) > 128 then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode='22023'; end if;
  if jsonb_typeof(v_customer) <> 'object' or octet_length(v_customer::text) > 12000 then raise exception 'INVALID_CUSTOMER_PAYLOAD' using errcode='22023'; end if;
  if jsonb_typeof(v_attribution) <> 'object' or octet_length(v_attribution::text) > 12000 then raise exception 'INVALID_ATTRIBUTION_PAYLOAD' using errcode='22023'; end if;
  if jsonb_typeof(v_metadata) <> 'object' or octet_length(v_metadata::text) > 16000 then raise exception 'INVALID_METADATA_PAYLOAD' using errcode='22023'; end if;

  select f0.id,f0.nome,f0.organization_id,f0.user_id,f0.status,f0.deleted_at into f
    from public.funnels f0 where f0.id=trim(p_funnel_id) and f0.deleted_at is null limit 1;
  if not found or coalesce(lower(f.status),'active') not in ('active','published','live') then raise exception 'CHECKOUT_NOT_AVAILABLE' using errcode='22023'; end if;

  select fo.id,fo.name,fo.price,fo.currency,fo.status,fo.product_id,fo.offer_type into o
    from public.funnel_offers fo where fo.id=p_offer_id and fo.funnel_id=f.id and fo.organization_id=f.organization_id and lower(fo.status) in ('active','published','live') limit 1;
  if not found then raise exception 'CHECKOUT_OFFER_NOT_FOUND' using errcode='22023'; end if;

  select p0.id,p0.name,p0.description,p0.product_type,p0.billing_type,p0.billing_interval,p0.interval_count,p0.unit_amount,p0.currency,p0.metadata into p
    from public.products p0 where p0.id=o.product_id and p0.organization_id=f.organization_id and p0.deleted_at is null and lower(p0.status)='active' limit 1;
  if not found then raise exception 'CHECKOUT_PRODUCT_NOT_FOUND' using errcode='22023'; end if;

  v_email := nullif(lower(trim(coalesce(v_customer->>'email',''))),'');
  if v_email is not null and (length(v_email)>320 or position('@' in v_email)=0) then raise exception 'INVALID_CUSTOMER_EMAIL' using errcode='22023'; end if;

  select * into v_existing from public.checkout_sessions where user_id=f.user_id and funnel_id=f.id and idempotency_key=v_key limit 1;
  if found then
    return jsonb_build_object('ok',true,'created',false,'session',jsonb_build_object('id',v_existing.id,'status',v_existing.status,'amount',v_existing.amount,'currency',v_existing.currency,'funnel_id',v_existing.funnel_id,'product_id',v_existing.product_id));
  end if;

  insert into public.checkout_sessions(user_id,funnel_id,product_id,status,currency,amount,customer,attribution,metadata,idempotency_key,organization_id)
  values(f.user_id,f.id,p.id,'started',upper(o.currency),o.price,v_customer,v_attribution,v_metadata,v_key,f.organization_id)
  returning * into v_session;

  insert into public.checkout_items(user_id,checkout_id,product_id,name,unit_amount,quantity,kind,organization_id)
  values(f.user_id,v_session.id,p.id,coalesce(o.name,p.name),o.price,1,'main',f.organization_id);

  insert into public.checkout_events(user_id,checkout_id,event_type,external_id,payload,organization_id)
  values(f.user_id,v_session.id,'checkout_started','checkout:'||v_session.id,jsonb_build_object('funnel_id',f.id,'offer_id',o.id,'product_id',p.id),f.organization_id)
  on conflict do nothing;

  return jsonb_build_object('ok',true,'created',true,'session',jsonb_build_object('id',v_session.id,'status',v_session.status,'amount',v_session.amount,'currency',v_session.currency,'funnel_id',v_session.funnel_id,'product_id',v_session.product_id));
exception when unique_violation then
  select * into v_existing from public.checkout_sessions where user_id=f.user_id and funnel_id=f.id and idempotency_key=v_key limit 1;
  if found then return jsonb_build_object('ok',true,'created',false,'session',jsonb_build_object('id',v_existing.id,'status',v_existing.status,'amount',v_existing.amount,'currency',v_existing.currency,'funnel_id',v_existing.funnel_id,'product_id',v_existing.product_id)); end if;
  raise;
end;
$function$;

revoke all on function public.get_public_checkout_context(text,uuid) from public,authenticated,anon;
grant execute on function public.get_public_checkout_context(text,uuid) to anon,authenticated;
revoke all on function public.create_public_checkout_session(text,uuid,jsonb,jsonb,jsonb,text) from public,authenticated,anon;
grant execute on function public.create_public_checkout_session(text,uuid,jsonb,jsonb,jsonb,text) to anon,authenticated;

commit;