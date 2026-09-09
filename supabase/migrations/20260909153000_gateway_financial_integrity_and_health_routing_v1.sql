create table if not exists public.gateway_financial_journals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  transaction_id uuid references public.gateway_transactions(id),
  gateway_id text references public.gateways(id),
  journal_type text not null,
  source_event_key text not null,
  currency text not null default 'BRL',
  status text not null default 'posted',
  metadata jsonb not null default '{}'::jsonb,
  posted_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  constraint gateway_financial_journals_type_ck check (journal_type in ('sale','refund','chargeback','fee','adjustment')),
  constraint gateway_financial_journals_status_ck check (status in ('posted','voided')),
  constraint gateway_financial_journals_currency_ck check (currency ~ '^[A-Z]{3}$'),
  constraint gateway_financial_journals_source_uk unique (user_id, source_event_key)
);

create table if not exists public.gateway_financial_entries (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null references public.gateway_financial_journals(id) on delete restrict,
  user_id uuid not null references auth.users(id),
  account_code text not null,
  direction text not null,
  amount numeric(20,4) not null,
  currency text not null default 'BRL',
  created_at timestamptz not null default timezone('utc', now()),
  constraint gateway_financial_entries_direction_ck check (direction in ('debit','credit')),
  constraint gateway_financial_entries_amount_ck check (amount > 0),
  constraint gateway_financial_entries_currency_ck check (currency ~ '^[A-Z]{3}$')
);

create index if not exists gateway_financial_journals_tx_idx on public.gateway_financial_journals(user_id, transaction_id, posted_at desc);
create index if not exists gateway_financial_journals_gateway_idx on public.gateway_financial_journals(user_id, gateway_id, posted_at desc);
create index if not exists gateway_financial_entries_journal_idx on public.gateway_financial_entries(journal_id);
create index if not exists gateway_financial_entries_account_idx on public.gateway_financial_entries(user_id, account_code, created_at desc);

alter table public.gateway_financial_journals enable row level security;
alter table public.gateway_financial_entries enable row level security;
drop policy if exists gateway_financial_journals_select_own on public.gateway_financial_journals;
create policy gateway_financial_journals_select_own on public.gateway_financial_journals for select to authenticated using (user_id = auth.uid());
drop policy if exists gateway_financial_entries_select_own on public.gateway_financial_entries;
create policy gateway_financial_entries_select_own on public.gateway_financial_entries for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.gateway_financial_journals from anon, authenticated;
revoke insert, update, delete on public.gateway_financial_entries from anon, authenticated;
revoke all on public.gateway_financial_journals from anon;
revoke all on public.gateway_financial_entries from anon;

drop function if exists public.prevent_gateway_financial_mutation();
create function public.prevent_gateway_financial_mutation() returns trigger language plpgsql security definer set search_path=public as $$
begin raise exception 'gateway_financial_ledger_append_only'; end; $$;
revoke all on function public.prevent_gateway_financial_mutation() from public;
create trigger gateway_financial_journals_append_only before update or delete on public.gateway_financial_journals for each row execute function public.prevent_gateway_financial_mutation();
create trigger gateway_financial_entries_append_only before update or delete on public.gateway_financial_entries for each row execute function public.prevent_gateway_financial_mutation();

create or replace function public.post_gateway_financial_journal(
  p_user_id uuid,
  p_transaction_id uuid,
  p_gateway_id text,
  p_journal_type text,
  p_source_event_key text,
  p_currency text,
  p_lines jsonb,
  p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_journal uuid;
  v_debit numeric := 0;
  v_credit numeric := 0;
  v_line jsonb;
  v_amount numeric;
  v_direction text;
  v_account text;
  v_tx_user uuid;
  v_gateway_user uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  if p_user_id is null or p_source_event_key is null or length(trim(p_source_event_key)) < 1 then raise exception 'invalid_journal_identity'; end if;
  if p_currency !~ '^[A-Z]{3}$' then raise exception 'invalid_currency'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then raise exception 'journal_lines_required'; end if;
  select user_id into v_tx_user from public.gateway_transactions where id=p_transaction_id;
  if p_transaction_id is not null and (v_tx_user is null or v_tx_user <> p_user_id) then raise exception 'transaction_tenant_mismatch'; end if;
  select user_id into v_gateway_user from public.gateways where id=p_gateway_id;
  if p_gateway_id is not null and (v_gateway_user is null or v_gateway_user <> p_user_id) then raise exception 'gateway_tenant_mismatch'; end if;
  select id into v_journal from public.gateway_financial_journals where user_id=p_user_id and source_event_key=p_source_event_key;
  if v_journal is not null then return v_journal; end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_direction := lower(trim(coalesce(v_line->>'direction','')));
    v_account := trim(coalesce(v_line->>'account_code',''));
    v_amount := nullif(v_line->>'amount','')::numeric;
    if v_direction not in ('debit','credit') or v_account='' or v_amount is null or v_amount <= 0 then raise exception 'invalid_journal_line'; end if;
    if v_direction='debit' then v_debit := v_debit + v_amount; else v_credit := v_credit + v_amount; end if;
  end loop;
  if round(v_debit,4) <> round(v_credit,4) then raise exception 'unbalanced_journal'; end if;
  insert into public.gateway_financial_journals(user_id,transaction_id,gateway_id,journal_type,source_event_key,currency,metadata)
  values(p_user_id,p_transaction_id,p_gateway_id,lower(trim(p_journal_type)),trim(p_source_event_key),p_currency,coalesce(p_metadata,'{}'::jsonb)) returning id into v_journal;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    insert into public.gateway_financial_entries(journal_id,user_id,account_code,direction,amount,currency)
    values(v_journal,p_user_id,trim(v_line->>'account_code'),lower(trim(v_line->>'direction')),(v_line->>'amount')::numeric,p_currency);
  end loop;
  return v_journal;
end; $$;
revoke all on function public.post_gateway_financial_journal(uuid,uuid,text,text,text,text,jsonb,jsonb) from public;
grant execute on function public.post_gateway_financial_journal(uuid,uuid,text,text,text,text,jsonb,jsonb) to service_role;

create or replace function public.rank_gateway_candidates(
  p_user_id uuid, p_gateway_ids text[], p_amount numeric, p_currency text, p_environment text
) returns table(gateway_id text, routing_score numeric, approval_rate numeric, latency_ms integer, healthy boolean, circuit_state text, cost_bps numeric)
language sql security definer set search_path=public as $$
with eligible as (
 select g.id::text gateway_id,g.circuit_id,g.capabilities,g.environment,
        coalesce(h.is_healthy,true) healthy,coalesce(h.latency_ms,0) latency_ms,
        coalesce(h.circuit_state,'closed') circuit_state,
        case when coalesce(h.circuit_state,'closed')='open' then 0 else 1 end circuit_ok
 from public.gateways g
 left join lateral (select hs.is_healthy,hs.latency_ms,hs.circuit_state from public.gateway_health_snapshots hs where hs.gateway_id=g.circuit_id order by hs.checked_at desc limit 1) h on true
 where g.user_id=p_user_id and g.id::text=any(p_gateway_ids)
   and lower(g.status) in ('connected','degraded')
   and lower(g.environment)=lower(p_environment)
   and (g.capabilities->'currencies' is null or jsonb_typeof(g.capabilities->'currencies')<>'array' or g.capabilities->'currencies' @> to_jsonb(upper(p_currency)))
   and (g.capabilities->>'min_amount' is null or g.capabilities->>'min_amount' !~ '^[0-9]+(\\.[0-9]+)?$' or p_amount >= (g.capabilities->>'min_amount')::numeric)
   and (g.capabilities->>'max_amount' is null or g.capabilities->>'max_amount' !~ '^[0-9]+(\\.[0-9]+)?$' or p_amount <= (g.capabilities->>'max_amount')::numeric)
), attempts as (
 select e.gateway_id,count(*) filter(where a.status in ('approved','declined','pending','error'))::numeric total,count(*) filter(where a.status='approved')::numeric approved
 from eligible e left join public.gateway_payment_attempts a on a.gateway_id=e.circuit_id and a.user_id=p_user_id and a.created_at>=now()-interval '30 days' group by e.gateway_id
), scored as (
 select e.gateway_id,round((e.circuit_ok*100.0)+(case when e.healthy then 25 else -35 end)+(case when e.latency_ms<=0 then 10 when e.latency_ms<=200 then 10 when e.latency_ms<=500 then 6 when e.latency_ms<=1000 then 2 else -10 end)+(case when coalesce(a.total,0)=0 then 8 else greatest(-15,least(20,((a.approved/nullif(a.total,0))*20)-5)) end)-(case when e.capabilities->>'cost_bps'~'^[0-9]+(\\.[0-9]+)?$' then least(15,(e.capabilities->>'cost_bps')::numeric/100.0) else 0 end),4) routing_score,
 case when coalesce(a.total,0)=0 then 1 else round((a.approved/nullif(a.total,0))*100,4) end approval_rate,e.latency_ms,e.healthy,e.circuit_state,
 case when e.capabilities->>'cost_bps'~'^[0-9]+(\\.[0-9]+)?$' then (e.capabilities->>'cost_bps')::numeric else 0 end cost_bps
 from eligible e left join attempts a on a.gateway_id=e.gateway_id
)
select gateway_id,routing_score,approval_rate,latency_ms,healthy,circuit_state,cost_bps from scored where circuit_state<>'open' order by routing_score desc,gateway_id asc;
$$;
revoke all on function public.rank_gateway_candidates(uuid,text[],numeric,text,text) from public;
grant execute on function public.rank_gateway_candidates(uuid,text[],numeric,text,text) to service_role;
