do $outer$ begin
  if not exists (select 1 from cron.job where jobname='althea-gateway-webhook-processor') then
    perform cron.schedule(
      'althea-gateway-webhook-processor',
      '* * * * *',
      $job$select net.http_post(
        url := 'https://hkraryqoziravulvqkid.supabase.co/functions/v1/gateway-webhook-processor',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-internal-secret',coalesce((select decrypted_secret from vault.decrypted_secrets where name='ALTHEA_INTERNAL_SECRET' limit 1),'')
        ),
        body := '{}'::jsonb
      );$job$
    );
  end if;
end $outer$;
