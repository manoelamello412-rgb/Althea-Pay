-- CPF do comprador no cliente.
-- 1) create_public_checkout_session: ao abrir o checkout, o lead já vira/atualiza o cliente com nome e CPF
--    (antes só a compra aprovada levava o documento para clients.data; Pix gerado e não pago ficava sem CPF).
--    A projeção nunca derruba o checkout: falha vira warning.
-- 2) Backfill: clientes sem CPF recebem o do checkout mais recente com o mesmo e-mail.

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

  -- Lead vira cliente já no checkout, com nome e CPF (só dígitos). Chaves existentes do cliente prevalecem.
  begin
    perform private.resolve_customer(
      f.organization_id,f.user_id,v_email,
      coalesce(v_customer->>'phone',v_customer->>'whatsapp'),
      null,null,
      jsonb_strip_nulls(jsonb_build_object(
        'name',nullif(btrim(coalesce(v_customer->>'name','')),''),
        'document',nullif(regexp_replace(coalesce(v_customer->>'document',v_customer->>'cpf',''),'[^0-9]+','','g'),''))));
  exception when others then
    raise warning 'CHECKOUT_CUSTOMER_PROJECTION_FAILED: %', sqlerrm;
  end;

  return jsonb_build_object('ok',true,'created',true,'session',jsonb_build_object('id',v_session.id,'status',v_session.status,'amount',v_session.amount,'currency',v_session.currency,'funnel_id',v_session.funnel_id,'product_id',v_session.product_id));
exception when unique_violation then
  select * into v_existing from public.checkout_sessions where user_id=f.user_id and funnel_id=f.id and idempotency_key=v_key limit 1;
  if found then return jsonb_build_object('ok',true,'created',false,'session',jsonb_build_object('id',v_existing.id,'status',v_existing.status,'amount',v_existing.amount,'currency',v_existing.currency,'funnel_id',v_existing.funnel_id,'product_id',v_existing.product_id)); end if;
  raise;
end;
$function$;

revoke all on function public.create_public_checkout_session(text,uuid,jsonb,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.create_public_checkout_session(text,uuid,jsonb,jsonb,jsonb,text) to service_role;

-- Backfill: CPF do checkout mais recente de cada e-mail, para clientes que ainda não têm.
update public.clients c
   set data = coalesce(c.data,'{}'::jsonb) || jsonb_build_object('document', s.document)
  from (
    select distinct on (cs.organization_id, lower(cs.customer->>'email'))
           cs.organization_id, lower(cs.customer->>'email') as email,
           regexp_replace(cs.customer->>'document','[^0-9]+','','g') as document
      from public.checkout_sessions cs
     where nullif(regexp_replace(coalesce(cs.customer->>'document',''),'[^0-9]+','','g'),'') is not null
       and nullif(cs.customer->>'email','') is not null
     order by cs.organization_id, lower(cs.customer->>'email'), cs.created_at desc
  ) s
  join public.customer_identities ci on ci.organization_id = s.organization_id and ci.kind = 'email' and ci.value = s.email
 where c.id = ci.client_id
   and c.organization_id = ci.organization_id
   and nullif(coalesce(c.data->>'document',''),'') is null;
