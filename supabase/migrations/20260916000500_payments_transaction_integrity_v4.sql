-- Stage 6: payment transaction integrity and tenant-safe attempt allocation
alter table public.gateway_transactions drop constraint if exists gateway_transactions_user_id_id_key;
alter table public.gateway_transactions drop constraint if exists gateway_transactions_user_id_idempotency_key_key;
alter table public.gateway_transactions add constraint gateway_transactions_id_organization_key unique (id, organization_id);
alter table public.gateway_transactions add constraint gateway_transactions_org_idempotency_key_key unique (organization_id, idempotency_key);
alter table public.gateway_payment_attempts drop constraint if exists gateway_payment_attempts_transaction_tenant_fk;
alter table public.gateway_payment_attempts add constraint gateway_payment_attempts_transaction_tenant_fk foreign key (transaction_id, organization_id) references public.gateway_transactions(id, organization_id);
create index if not exists gateway_payment_attempts_transaction_id_idx on public.gateway_payment_attempts(transaction_id);
create index if not exists gateway_payment_attempts_org_created_idx on public.gateway_payment_attempts(organization_id, created_at desc);
create index if not exists gateway_transactions_org_created_idx on public.gateway_transactions(organization_id, created_at desc);
create index if not exists gateway_transactions_funnel_idx on public.gateway_transactions(funnel_id, created_at desc);
create index if not exists gateway_transactions_product_idx on public.gateway_transactions(product_id, created_at desc) where product_id is not null;

create or replace function public.allocate_and_insert_gateway_payment_attempt(p_user_id uuid,p_transaction_id uuid,p_gateway_id text,p_gateway_name text,p_idempotency_key text,p_status text default 'pending',p_failure_class text default null,p_external_transaction_id text default null,p_routing_rule_id uuid default null,p_routing_policy_id uuid default null,p_routing_policy_version bigint default null,p_decision_reason text default null,p_provider_request_id text default null,p_duration_ms integer default null,p_sale_id text default null,p_product_id text default null) returns public.gateway_payment_attempts language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_tx public.gateway_transactions%rowtype; v_attempt public.gateway_payment_attempts; v_next_order integer; v_status text:=lower(trim(coalesce(p_status,'pending')));
begin
 if auth.role()<>'service_role' then raise exception 'forbidden'; end if;
 if p_user_id is null or p_transaction_id is null or p_gateway_id is null or nullif(trim(p_gateway_name),'') is null or nullif(trim(p_idempotency_key),'') is null then raise exception 'attempt_identity_required'; end if;
 if v_status not in ('pending','processing','approved','declined','error','unknown') then raise exception 'invalid_attempt_status'; end if;
 if p_duration_ms is not null and p_duration_ms<0 then raise exception 'invalid_duration'; end if;
 select * into v_tx from public.gateway_transactions where id=p_transaction_id and user_id=p_user_id for update;
 if not found then raise exception 'transaction_not_found'; end if;
 if not exists(select 1 from public.gateways g where g.id=p_gateway_id and g.user_id=p_user_id and g.organization_id=v_tx.organization_id) then raise exception 'gateway_not_found'; end if;
 select coalesce(max(a.attempt_order),0)+1 into v_next_order from public.gateway_payment_attempts a where a.transaction_id=p_transaction_id and a.organization_id=v_tx.organization_id;
 insert into public.gateway_payment_attempts(user_id,sale_id,product_id,gateway_id,gateway_name,routing_rule_id,idempotency_key,attempt_order,status,failure_class,external_transaction_id,transaction_id,routing_policy_id,routing_policy_version,decision_reason,provider_request_id,duration_ms,organization_id,created_at,updated_at,completed_at) values(p_user_id,p_sale_id,p_product_id,p_gateway_id,trim(p_gateway_name),p_routing_rule_id,trim(p_idempotency_key),v_next_order,v_status,p_failure_class,p_external_transaction_id,p_transaction_id,p_routing_policy_id,p_routing_policy_version,p_decision_reason,p_provider_request_id,p_duration_ms,v_tx.organization_id,now(),now(),case when v_status in ('approved','declined','error') then now() else null end) returning * into v_attempt;
 return v_attempt;
end; $$;
revoke execute on function public.allocate_and_insert_gateway_payment_attempt(uuid,uuid,text,text,text,text,text,text,uuid,uuid,bigint,text,text,integer,text,text) from anon,authenticated;
grant execute on function public.allocate_and_insert_gateway_payment_attempt(uuid,uuid,text,text,text,text,text,text,uuid,uuid,bigint,text,text,integer,text,text) to service_role;

-- Remove the redundant duplicate reconciliation FK introduced by legacy tenant constraints.
alter table public.reconciliation_items drop constraint if exists reconciliation_items_transaction_fk;
