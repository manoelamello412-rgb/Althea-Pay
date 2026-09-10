do $outer$
begin
  if not exists (select 1 from cron.job where jobname='iara-commercial-intervention-worker') then
    perform cron.schedule('iara-commercial-intervention-worker','* * * * *', $cron$select net.http_post(url := 'https://hkraryqoziravulvqkid.supabase.co/functions/v1/iara-commercial-intervention-worker', headers := jsonb_build_object('Content-Type','application/json','X-Althea-Internal-Secret',(select decrypted_secret from vault.decrypted_secrets where name='ALTHEA_INTERNAL_SECRET' limit 1)), body := '{}'::jsonb);$cron$);
  end if;
  if not exists (select 1 from cron.job where jobname='iara-daily-report-worker') then
    perform cron.schedule('iara-daily-report-worker','0 9 * * *', $cron$select net.http_post(url := 'https://hkraryqoziravulvqkid.supabase.co/functions/v1/iara-daily-report-worker', headers := jsonb_build_object('Content-Type','application/json','X-Althea-Internal-Secret',(select decrypted_secret from vault.decrypted_secrets where name='ALTHEA_INTERNAL_SECRET' limit 1)), body := '{}'::jsonb);$cron$);
  end if;
end $outer$;
