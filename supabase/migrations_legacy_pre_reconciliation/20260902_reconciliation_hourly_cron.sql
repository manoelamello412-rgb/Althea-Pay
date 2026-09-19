create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.trigger_reconciliation_worker()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare request_id bigint; internal_secret text;
begin
  select public.get_althea_internal_secret() into internal_secret;
  if internal_secret is null or internal_secret = '' then raise exception 'ALTHEA internal secret is not configured'; end if;
  select net.http_post(url:='https://hkraryqoziravulvqkid.supabase.co/functions/v1/reconciliation-worker',body:=jsonb_build_object('source','pg_cron','scheduled_at',now()),headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',internal_secret),timeout_milliseconds:=5000) into request_id;
  return request_id;
end;
$$;
revoke all on function public.trigger_reconciliation_worker() from public,anon,authenticated;
grant execute on function public.trigger_reconciliation_worker() to postgres,service_role;
do $$ declare job_id bigint; begin select jobid into job_id from cron.job where jobname='althea-reconciliation-hourly' limit 1;if job_id is not null then perform cron.unschedule(job_id);end if;perform cron.schedule('althea-reconciliation-hourly','0 * * * *','select public.trigger_reconciliation_worker();');end $$;
