
do $$
begin
  if exists(select 1 from cron.job where jobname='althea-checkout-recovery-enqueue') then
    perform cron.unschedule('althea-checkout-recovery-enqueue');
  end if;
  if exists(select 1 from cron.job where jobname='althea-checkout-recovery-worker') then
    perform cron.unschedule('althea-checkout-recovery-worker');
  end if;
end
$$;

select cron.schedule(
  'althea-checkout-recovery-enqueue',
  '*/5 * * * *',
  'select public.enqueue_checkout_recovery_events(100);'
);

select cron.schedule(
  'althea-checkout-recovery-worker',
  '* * * * *',
  $command$
  select net.http_post(
    url := 'https://hkraryqoziravulvqkid.supabase.co/functions/v1/checkout-recovery-worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-secret',(select decrypted_secret from vault.decrypted_secrets where name='ALTHEA_INTERNAL_SECRET' limit 1)
    ),
    body := '{"limit":25}'::jsonb
  );
  $command$
);
