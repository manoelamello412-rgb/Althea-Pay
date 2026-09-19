update public.gateway_provider_registry
set operational = true,
    updated_at = now()
where provider_key = 'custom_rest'
  and is_active = true
  and exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'gateway_provider_adapter'
  );