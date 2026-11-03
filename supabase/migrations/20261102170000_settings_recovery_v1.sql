-- Fase 4.1: o interruptor de recuperação de carrinho (platform_settings.recovery.cartAutomation do dono da org)
-- é o que enqueue_checkout_recovery_events lê. A tela passa a ler/gravar por aqui, para qualquer membro com
-- can_manage_automations (a linha é do dono, que a RLS de platform_settings não deixa outro membro tocar).

create or replace function public.recovery_settings_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
  v_owner uuid;
begin
  if auth.uid() is null or v_org is null or not private.is_org_member(v_org) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  v_owner := private.organization_owner_id(v_org);
  return jsonb_build_object(
    'cart_automation', coalesce((select (data#>>'{recovery,cartAutomation}')::boolean from public.platform_settings where user_id = v_owner), false),
    'can_edit', private.has_org_capability(v_org, 'can_manage_automations'));
end;
$function$;

create or replace function public.recovery_settings_set_v1(p_cart_automation boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  c record;
begin
  select * into c from private.crm_config_context('can_manage_automations');
  insert into public.platform_settings (user_id, data, updated_at)
  values (c.owner_id, jsonb_build_object('recovery', jsonb_build_object('cartAutomation', coalesce(p_cart_automation, false))), now())
  on conflict (user_id) do update
    set data = jsonb_set(coalesce(public.platform_settings.data, '{}'::jsonb), '{recovery}',
               coalesce(public.platform_settings.data->'recovery', '{}'::jsonb) || jsonb_build_object('cartAutomation', coalesce(p_cart_automation, false))),
        updated_at = now();
  insert into public.audit_logs (user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (c.owner_id, auth.uid(), c.organization_id, 'settings.recovery.updated', 'platform_settings', c.owner_id::text,
          jsonb_build_object('cart_automation', coalesce(p_cart_automation, false)));
end;
$function$;

revoke all on function public.recovery_settings_v1() from public, anon;
revoke all on function public.recovery_settings_set_v1(boolean) from public, anon;
grant execute on function public.recovery_settings_v1() to authenticated;
grant execute on function public.recovery_settings_set_v1(boolean) to authenticated;
