create extension if not exists pg_cron with schema pg_catalog;
do $block$ begin
  if not exists (select 1 from cron.job where jobname='althea-abandoned-checkouts') then
    perform cron.schedule('althea-abandoned-checkouts','*/5 * * * *',$job$select public.mark_abandoned_checkouts(30);$job$);
  end if;
end $block$;