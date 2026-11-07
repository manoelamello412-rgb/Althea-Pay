-- The campaign cron only enqueues outbox rows; this job delivers them (Resend, Infobip, Twilio, funnel chat).
-- Replaces any dispatcher job created by hand in the dashboard so it never runs twice.
do $$
declare
  j record;
begin
  for j in select jobid from cron.job where jobname = 'althea-crm-outbox-dispatcher' or command like '%crm-channel-outbox-dispatcher%' loop
    perform cron.unschedule(j.jobid);
  end loop;
end
$$;

select cron.schedule(
  'althea-crm-outbox-dispatcher',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://hkraryqoziravulvqkid.supabase.co/functions/v1/crm-channel-outbox-dispatcher',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-secret',coalesce((select decrypted_secret from vault.decrypted_secrets where name='ALTHEA_INTERNAL_SECRET' limit 1),'')
    ),
    body := '{"limit":50}'::jsonb
  );
  $$
);
