create or replace function public.configure_funnel_checkout_step(
  p_step_id uuid,
  p_offer_id uuid,
  p_payment_methods jsonb default '["pix","card","boleto"]'::jsonb
)
returns public.funnel_steps
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step public.funnel_steps%rowtype;
  v_offer public.funnel_offers%rowtype;
  v_funnel public.funnels%rowtype;
  v_gateway public.gateways%rowtype;
  v_role text;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;

  select * into v_step from public.funnel_steps where id = p_step_id;
  if not found then raise exception 'STEP_NOT_FOUND'; end if;
  select * into v_offer from public.funnel_offers where id = p_offer_id;
  if not found then raise exception 'OFFER_NOT_FOUND'; end if;
  if v_step.funnel_id <> v_offer.funnel_id then raise exception 'FUNNEL_MISMATCH'; end if;
  if v_step.step_type not in ('checkout','payment') then raise exception 'INVALID_CHECKOUT_STEP_TYPE'; end if;

  select * into v_funnel from public.funnels where id = v_step.funnel_id and deleted_at is null;
  if not found then raise exception 'FUNNEL_NOT_FOUND'; end if;
  if v_funnel.organization_id is null then raise exception 'ORGANIZATION_REQUIRED'; end if;

  select om.role into v_role
  from public.organization_members om
  where om.organization_id = v_funnel.organization_id and om.user_id = auth.uid() and om.status = 'active'
  limit 1;
  if v_role is null or v_role not in ('owner','admin','manager','operator') then raise exception 'FORBIDDEN'; end if;

  if v_offer.organization_id <> v_funnel.organization_id then raise exception 'ORGANIZATION_MISMATCH'; end if;
  if v_offer.enabled is distinct from true then raise exception 'OFFER_NOT_ACTIVE'; end if;

  select g.* into v_gateway
  from public.funnel_gateway_bindings b
  join public.gateways g on g.id = b.gateway_id
  where b.funnel_id = v_step.funnel_id
    and b.organization_id = v_funnel.organization_id
    and b.role = 'payment'
    and b.is_primary = true
    and b.status = 'active'
    and lower(coalesce(g.status,'')) not in ('disabled','inactive','disconnected')
  order by b.priority asc
  limit 1;
  if not found then raise exception 'PRIMARY_GATEWAY_REQUIRED'; end if;

  if jsonb_typeof(p_payment_methods) <> 'array' then raise exception 'PAYMENT_METHODS_INVALID'; end if;
  if jsonb_array_length(p_payment_methods) = 0 then raise exception 'PAYMENT_METHODS_REQUIRED'; end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_payment_methods) method
    where method not in ('pix','card','boleto','wallet','bank_transfer','other')
  ) then raise exception 'PAYMENT_METHOD_UNSUPPORTED'; end if;

  update public.funnel_offers
  set step_id = p_step_id, updated_at = now()
  where id = p_offer_id;

  update public.funnel_steps
  set config = coalesce(config,'{}'::jsonb)
      || jsonb_build_object('checkout', jsonb_build_object(
           'offer_id', p_offer_id,
           'gateway_id', v_gateway.id,
           'payment_methods', p_payment_methods,
           'configured_at', now()
         )),
      status = case when status = 'draft' then 'active' else status end,
      updated_at = now()
  where id = p_step_id
  returning * into v_step;

  return v_step;
end;
$$;

grant execute on function public.configure_funnel_checkout_step(uuid,uuid,jsonb) to authenticated;