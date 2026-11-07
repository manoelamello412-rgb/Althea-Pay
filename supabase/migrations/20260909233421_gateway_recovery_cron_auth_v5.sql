create or replace function public.verify_gateway_recovery_cron_signature(p_timestamp bigint,p_signature text)
returns boolean
language plpgsql
security definer
set search_path=public,vault,pg_catalog
as $fn$
declare secret text; expected text; now_epoch bigint;
begin
  now_epoch:=extract(epoch from clock_timestamp())::bigint;
  if abs(now_epoch-p_timestamp)>300 then return false; end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name='ALTHEA_INTERNAL_SECRET' limit 1;
  if secret is null or length(secret)=0 then return false; end if;
  expected:=encode(digest(secret||':'||p_timestamp::text,'sha256'),'hex');
  return lower(coalesce(p_signature,''))=lower(expected);
end;
$fn$;
revoke all on function public.verify_gateway_recovery_cron_signature(bigint,text) from public,anon,authenticated;
grant execute on function public.verify_gateway_recovery_cron_signature(bigint,text) to service_role;
do $outer$
declare jid bigint;
begin
  select jobid into jid from cron.job where jobname='althea-gateway-attempt-recovery';
  if jid is not null then perform cron.unschedule(jid); end if;
  perform cron.schedule('althea-gateway-attempt-recovery','* * * * *', $cmd$with t as (select extract(epoch from clock_timestamp())::bigint ts, decrypted_secret secret from vault.decrypted_secrets where name='ALTHEA_INTERNAL_SECRET' limit 1) select net.http_post(url := 'https://hkraryqoziravulvqkid.supabase.co/functions/v1/gateway-attempt-recovery', headers := jsonb_build_object('Content-Type','application/json','x-althea-recovery-timestamp',t.ts::text,'x-althea-recovery-signature',encode(digest(t.secret||':'||t.ts::text,'sha256'),'hex')), body := '{"limit":25}'::jsonb) from t;$cmd$);
end $outer$;