begin;

-- Settlement is the sole ledger authority for aggregated provider fees.
drop trigger if exists trg_gateway_fee_financial_posting on public.reconciliation_items;

-- Provider token links must belong to the same tenant and the declared provider
-- must match the gateway provider. Tokens remain Vault-backed through secret_ref.
create or replace function public.validate_gateway_payment_token_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare g_provider text; g_user uuid; i_user uuid;
begin
  select provider, user_id into g_provider, g_user from public.gateways where id = new.gateway_id;
  if g_provider is null then raise exception 'gateway_not_found_for_token_link'; end if;
  if g_user <> new.user_id then raise exception 'gateway_token_link_tenant_mismatch'; end if;
  if lower(g_provider) <> lower(new.provider) then raise exception 'gateway_token_provider_mismatch'; end if;
  select user_id into i_user from public.gateway_payment_instruments where id = new.instrument_id;
  if i_user is null then raise exception 'payment_instrument_not_found'; end if;
  if i_user <> new.user_id then raise exception 'payment_instrument_tenant_mismatch'; end if;
  if coalesce(length(trim(new.secret_ref)),0) = 0 then raise exception 'gateway_token_secret_ref_required'; end if;
  if coalesce(length(trim(new.token_fingerprint)),0) < 16 then raise exception 'gateway_token_fingerprint_required'; end if;
  return new;
end $$;

drop trigger if exists trg_validate_gateway_payment_token_link on public.gateway_payment_token_links;
create trigger trg_validate_gateway_payment_token_link
before insert or update of user_id, instrument_id, gateway_id, provider, secret_ref, token_fingerprint
on public.gateway_payment_token_links
for each row execute function public.validate_gateway_payment_token_link();

revoke execute on function public.validate_gateway_payment_token_link() from public, anon, authenticated;
grant execute on function public.validate_gateway_payment_token_link() to service_role;

-- Reconciliation provider event identity is tenant scoped; blank event ids are ignored.
create unique index if not exists uq_reconciliation_provider_event_tenant
on public.reconciliation_items(user_id, provider_event_id)
where provider_event_id is not null and length(trim(provider_event_id)) > 0;

-- Bound observability telemetry.
alter table public.gateway_operation_logs
  drop constraint if exists gateway_operation_logs_duration_nonnegative,
  drop constraint if exists gateway_operation_logs_attempt_positive;
alter table public.gateway_operation_logs
  add constraint gateway_operation_logs_duration_nonnegative check (duration_ms is null or duration_ms >= 0),
  add constraint gateway_operation_logs_attempt_positive check (attempt is null or attempt > 0);

commit;
