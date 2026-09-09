create or replace function public.claim_gateway_recovery_jobs(p_limit integer default 25)
returns setof public.gateway_recovery_queue
language plpgsql
security definer
set search_path=public
as $fn$
declare v_limit integer := greatest(1, least(coalesce(p_limit,25),100));
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required'; end if;
  return query
  with picked as (
    select id from public.gateway_recovery_queue
    where status='queued' and next_retry_at <= now()
    order by next_retry_at, created_at
    for update skip locked limit v_limit
  )
  update public.gateway_recovery_queue q
  set status='processing', attempts=q.attempts+1, updated_at=now()
  from picked where q.id=picked.id returning q.*;
end;
$fn$;
revoke all on function public.claim_gateway_recovery_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_gateway_recovery_jobs(integer) to service_role;

do $outer$
declare jid bigint;
begin
  select jobid into jid from cron.job where jobname='althea-gateway-attempt-recovery';
  if jid is not null then perform cron.unschedule(jid); end if;
  perform cron.schedule('althea-gateway-attempt-recovery','* * * * *', $cmd$select net.http_post(url := 'https://hkraryqoziravulvqkid.supabase.co/functions/v1/gateway-attempt-recovery', headers := jsonb_build_object('Content-Type','application/json','x-althea-internal-secret',coalesce((select decrypted_secret from vault.decrypted_secrets where name='ALTHEA_INTERNAL_SECRET' limit 1),'')), body := '{"limit":25}'::jsonb);$cmd$);
end $outer$;