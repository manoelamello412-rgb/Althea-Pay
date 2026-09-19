create or replace function public.claim_integration_event(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_claimed timestamptz;
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  select status, claimed_at into v_status, v_claimed
  from public.integration_events where id=p_event_id for update;
  if not found then return false; end if;
  if v_status='processing' and (v_claimed is null or v_claimed > now()-interval '10 minutes') then return false; end if;
  if v_status not in ('pending','retry','received','processing') then return false; end if;
  update public.integration_events
  set status='processing', claimed_at=now(), claim_attempt=coalesce(claim_attempt,0)+1,
      error_message=null, processed_at=null
  where id=p_event_id;
  return true;
end; $$;

create or replace function public.mark_integration_event_processed(p_event_id uuid, p_status text default 'processed', p_error text default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  update public.integration_events
  set status=p_status,
      processed_at=case when p_status='processed' then now() else null end,
      error_message=left(p_error,2000),
      claimed_at=case when p_status='processed' then null else claimed_at end
  where id=p_event_id and status='processing';
end; $$;

grant execute on function public.mark_integration_event_processed(uuid,text,text) to service_role;