
create or replace function public.verify_althea_internal_secret(p_secret text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_secret text;
begin
  if p_secret is null or length(p_secret) < 16 then
    return false;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name='ALTHEA_INTERNAL_SECRET'
  limit 1;

  return v_secret is not null and p_secret = v_secret;
end;
$$;

revoke all on function public.verify_althea_internal_secret(text) from public, anon, authenticated;
grant execute on function public.verify_althea_internal_secret(text) to service_role;

do $$
begin
  if exists(select 1 from cron.job where jobname='althea-funnel-command-worker') then
    perform cron.unschedule('althea-funnel-command-worker');
  end if;
  if exists(select 1 from cron.job where jobname='althea-funnel-drift-worker') then
    perform cron.unschedule('althea-funnel-drift-worker');
  end if;
end $$;

select cron.schedule(
  'althea-funnel-command-worker',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://hkraryqoziravulvqkid.supabase.co/functions/v1/funnel-command-worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-althea-internal-secret',coalesce((select decrypted_secret from vault.decrypted_secrets where name='ALTHEA_INTERNAL_SECRET' limit 1),'')
    ),
    body := '{"limit":50}'::jsonb
  );
  $$
);

select cron.schedule(
  'althea-funnel-drift-worker',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://hkraryqoziravulvqkid.supabase.co/functions/v1/funnel-drift-worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-althea-internal-secret',coalesce((select decrypted_secret from vault.decrypted_secrets where name='ALTHEA_INTERNAL_SECRET' limit 1),'')
    ),
    body := '{"limit":100}'::jsonb
  );
  $$
);
