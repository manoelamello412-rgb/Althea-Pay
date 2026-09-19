create or replace function public.bind_gateway_transaction_gateway(p_transaction_id uuid,p_user_id uuid,p_gateway_id text,p_expected_version bigint)
returns public.gateway_transactions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v public.gateway_transactions; g public.gateways;
begin
 if auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
 select * into v from public.gateway_transactions where id=p_transaction_id and user_id=p_user_id for update;
 if not found then raise exception 'transaction_not_found'; end if;
 if p_expected_version is not null and v.version<>p_expected_version then raise exception 'concurrency_stale_detected'; end if;
 if v.status not in ('created','pending') then raise exception 'gateway_binding_not_allowed_for_terminal_transaction'; end if;
 select * into g from public.gateways where id=p_gateway_id for share;
 if not found then raise exception 'gateway_not_found'; end if;
 if g.organization_id is distinct from v.organization_id then raise exception 'gateway_tenant_mismatch'; end if;
 if coalesce(lower(g.status),'') not in ('active','connected','operational') then raise exception 'gateway_not_operational'; end if;
 update public.gateway_transactions set gateway_id=p_gateway_id,version=version+1,updated_at=now() where id=v.id and user_id=p_user_id and version=v.version returning * into v;
 if not found then raise exception 'concurrency_update_failed'; end if;
 return v;
end;$$;
grant execute on function public.bind_gateway_transaction_gateway(uuid,uuid,text,bigint) to service_role;