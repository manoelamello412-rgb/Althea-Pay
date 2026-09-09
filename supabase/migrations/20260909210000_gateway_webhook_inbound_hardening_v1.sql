-- ALTHEA PAY Gateway inbound webhook hardening.
-- Reuses the canonical gateway_webhook_events ledger; no parallel inbound table.

alter table public.gateway_webhook_events
  add column if not exists gateway_id text;

-- Existing accepted events may already carry the gateway identity in the normalized payload.
update public.gateway_webhook_events
set gateway_id = nullif(trim(payload->>'_althea_gateway_id'), '')
where gateway_id is null
  and jsonb_typeof(payload) = 'object'
  and nullif(trim(payload->>'_althea_gateway_id'), '') is not null;

create index if not exists gateway_webhook_events_gateway_status_idx
  on public.gateway_webhook_events(gateway_id, status, received_at);

create index if not exists gateway_webhook_events_gateway_event_idx
  on public.gateway_webhook_events(gateway_id, provider, provider_event_id);

comment on column public.gateway_webhook_events.gateway_id is
  'Canonical ALTHEA PAY gateway identity captured at inbound authentication time. Nullable for legacy events.';

create or replace function public.ingest_gateway_webhook_v2(
  p_gateway_id text,
  p_provider text,
  p_provider_event_id text,
  p_signature_timestamp timestamptz,
  p_payload jsonb
)
returns table(duplicate boolean, webhook_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_id uuid;
  v_provider text;
  v_gateway_provider text;
begin
  if coalesce(length(trim(p_gateway_id)),0)=0
     or coalesce(length(trim(p_provider)),0)=0
     or coalesce(length(trim(p_provider_event_id)),0)=0 then
    raise exception 'gateway_provider_and_event_id_required';
  end if;

  select lower(trim(provider))
    into v_gateway_provider
  from public.gateways
  where id = trim(p_gateway_id)
  limit 1;

  if v_gateway_provider is null then
    raise exception 'gateway_not_found';
  end if;

  v_provider := lower(trim(p_provider));
  if v_gateway_provider <> v_provider then
    raise exception 'gateway_provider_mismatch';
  end if;

  insert into public.gateway_webhook_events(
    gateway_id,
    provider,
    provider_event_id,
    signature_timestamp,
    payload,
    status,
    received_at,
    updated_at,
    next_attempt_at
  )
  values(
    trim(p_gateway_id),
    v_provider,
    trim(p_provider_event_id),
    p_signature_timestamp,
    coalesce(p_payload,'{}'::jsonb),
    'accepted',
    now(),
    now(),
    now()
  )
  on conflict(provider,provider_event_id) do nothing
  returning id into v_id;

  if v_id is null then
    select e.id
      into v_id
    from public.gateway_webhook_events e
    where e.provider = v_provider
      and e.provider_event_id = trim(p_provider_event_id)
    limit 1;
    return query select true, v_id;
  end if;

  return query select false, v_id;
end
$function$;

revoke all on function public.ingest_gateway_webhook_v2(text,text,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.ingest_gateway_webhook_v2(text,text,text,timestamptz,jsonb) to service_role;

-- Keep the inbound event ledger service-only. Provider-facing authentication remains in the Edge Function.
drop policy if exists gateway_webhook_events_service_only on public.gateway_webhook_events;
create policy gateway_webhook_events_service_only
on public.gateway_webhook_events
for all to service_role
using (true)
with check (true);
