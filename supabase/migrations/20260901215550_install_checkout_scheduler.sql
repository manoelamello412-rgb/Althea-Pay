create extension if not exists pg_cron with schema pg_catalog;
DO $do$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname='althea-abandoned-checkouts';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
  PERFORM cron.schedule('althea-abandoned-checkouts','*/5 * * * *', 'select public.mark_abandoned_checkouts(30);');
END
$do$;