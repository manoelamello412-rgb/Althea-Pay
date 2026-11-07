create extension if not exists pg_net with schema extensions;
DO $do$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname='althea-event-worker';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
  PERFORM cron.schedule('althea-event-worker','* * * * *', $$select net.http_post(url := 'https://hkraryqoziravulvqkid.supabase.co/functions/v1/event-worker', headers := jsonb_build_object('Content-Type','application/json','x-internal-secret',coalesce((select decrypted_secret from vault.decrypted_secrets where name='ALTHEA_INTERNAL_SECRET' limit 1),'')), body := '{"limit":50}'::jsonb);$$);
END
$do$;