create or replace function public.sales_ledger_for_user(
  p_search text default null,
  p_status text default 'all',
  p_from date default null,
  p_to date default null,
  p_funnel_id text default null,
  p_gateway_id text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with filtered as (
    select gt.id, gt.user_id, gt.funnel_id, gt.product_id, gt.gateway_id, gt.external_id, gt.idempotency_key,
      gt.amount, gt.currency, gt.status, gt.customer, gt.metadata, gt.error_message, gt.created_at, gt.updated_at,
      gt.attempt_count, gt.completed_at, gt.failure_code, gt.routing_metadata, gt.version
    from public.gateway_transactions gt
    where gt.user_id = auth.uid()
      and (p_from is null or gt.created_at >= p_from::timestamp with time zone)
      and (p_to is null or gt.created_at < (p_to + 1)::timestamp with time zone)
      and (p_funnel_id is null or p_funnel_id = '' or gt.funnel_id = p_funnel_id)
      and (p_gateway_id is null or p_gateway_id = '' or gt.gateway_id = p_gateway_id)
      and (coalesce(p_status,'all') = 'all' or lower(gt.status)=lower(p_status)
           or (lower(p_status)='approved' and lower(gt.status) in ('approved','completed','paid','success','succeeded')))
      and (p_search is null or trim(p_search)='' or gt.id::text ilike '%'||trim(p_search)||'%'
           or coalesce(gt.external_id,'') ilike '%'||trim(p_search)||'%'
           or coalesce(gt.gateway_id,'') ilike '%'||trim(p_search)||'%'
           or coalesce(gt.funnel_id,'') ilike '%'||trim(p_search)||'%'
           or coalesce(gt.product_id,'') ilike '%'||trim(p_search)||'%'
           or coalesce(gt.customer::text,'') ilike '%'||trim(p_search)||'%'
           or coalesce(gt.metadata::text,'') ilike '%'||trim(p_search)||'%')
  ),
  page as (
    select * from filtered order by created_at desc, id desc
    limit greatest(1, least(coalesce(p_limit,50),100)) offset greatest(coalesce(p_offset,0),0)
  ),
  summary as (
    select count(*)::bigint total_count,
      count(*) filter(where lower(status) in ('approved','completed','paid','success','succeeded'))::bigint approved_count,
      coalesce(sum(amount) filter(where lower(status) in ('approved','completed','paid','success','succeeded')),0)::numeric approved_volume,
      count(*) filter(where lower(status) in ('pending','created'))::bigint pending_count,
      count(*) filter(where lower(status) in ('failed','error','declined'))::bigint failed_count,
      count(*) filter(where lower(status)='refunded')::bigint refunded_count,
      count(*) filter(where lower(status)='chargeback')::bigint chargeback_count
    from filtered
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id desc) from page),'[]'::jsonb),
    'summary',to_jsonb(summary),
    'limit',greatest(1,least(coalesce(p_limit,50),100)),
    'offset',greatest(coalesce(p_offset,0),0)
  ) from summary;
$$;

revoke all on function public.sales_ledger_for_user(text,text,date,date,text,text,integer,integer) from public, anon;
grant execute on function public.sales_ledger_for_user(text,text,date,date,text,text,integer,integer) to authenticated;

create index if not exists idx_gateway_transactions_user_created_at on public.gateway_transactions(user_id,created_at desc,id desc);
create index if not exists idx_gateway_transactions_user_status_created_at on public.gateway_transactions(user_id,status,created_at desc,id desc);
create index if not exists idx_gateway_transactions_user_funnel_created_at on public.gateway_transactions(user_id,funnel_id,created_at desc,id desc);
create index if not exists idx_gateway_transactions_user_gateway_created_at on public.gateway_transactions(user_id,gateway_id,created_at desc,id desc);
