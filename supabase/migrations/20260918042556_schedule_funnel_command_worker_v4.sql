
do $$
begin
  if exists(select 1 from cron.job where jobname='althea-funnel-command-worker') then
    perform cron.unschedule('althea-funnel-command-worker');
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
      'x-internal-secret',coalesce((select decrypted_secret from vault.decrypted_secrets where name='ALTHEA_INTERNAL_SECRET' limit 1),'')
    ),
    body := '{"limit":50}'::jsonb
  );
  $$
);
