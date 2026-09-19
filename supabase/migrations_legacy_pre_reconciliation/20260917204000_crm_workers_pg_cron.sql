-- Canonicalize CRM background scheduling in Supabase pg_cron.
-- Internal workers authenticate with ALTHEA_INTERNAL_SECRET from Vault.

select cron.schedule(
  'althea-automation-retry-worker',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://hkraryqoziravulvqkid.supabase.co/functions/v1/automation-retry-worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-secret',coalesce((select decrypted_secret from vault.decrypted_secrets where name='ALTHEA_INTERNAL_SECRET' limit 1),'')
    ),
    body := '{"limit":100}'::jsonb
  );
  $$
);

select cron.schedule(
  'althea-crm-predictive-outcome-worker',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://hkraryqoziravulvqkid.supabase.co/functions/v1/crm-predictive-outcome-worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-secret',coalesce((select decrypted_secret from vault.decrypted_secrets where name='ALTHEA_INTERNAL_SECRET' limit 1),'')
    ),
    body := '{"limit":500}'::jsonb
  );
  $$
);
