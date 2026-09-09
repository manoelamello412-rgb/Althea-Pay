create or replace function public.verify_gateway_recovery_cron_token(p_token text)
returns boolean
language sql
security definer
set search_path=public,vault,pg_catalog
as $fn$
  select coalesce(p_token <> '' and p_token=(select decrypted_secret from vault.decrypted_secrets where name='ALTHEA_INTERNAL_SECRET' limit 1),false)
$fn$;
revoke all on function public.verify_gateway_recovery_cron_token(text) from public,anon,authenticated;
grant execute on function public.verify_gateway_recovery_cron_token(text) to service_role;
do $outer$
declare jid bigint;
begin
  select jobid into jid from cron.job where jobname='althea-gateway-attempt-recovery';
  if jid is not null then perform cron.unschedule(jid); end if;
  perform cron.schedule('althea-gateway-attempt-recovery','* * * * *', $cmd$select net.http_post(url := 'https://hkraryqoziravulvqkid.supabase.co/functions/v1/gateway-attempt-recovery', headers := jsonb_build_object('Content-Type','application/json','x-althea-recovery-token',coalesce((select decrypted_secret from vault.decrypted_secrets where name='ALTHEA_INTERNAL_SECRET' limit 1),'')), body := '{"limit":25}'::jsonb);$cmd$);
end $outer$;