alter table public.gateway_financial_journals add constraint gateway_financial_journals_id_user_uk unique (id,user_id);
alter table public.gateway_financial_entries drop constraint if exists gateway_financial_entries_journal_id_fkey;
alter table public.gateway_financial_entries add constraint gateway_financial_entries_journal_user_fkey foreign key (journal_id,user_id) references public.gateway_financial_journals(id,user_id) on delete restrict;

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
  if lower(trim(p_journal_type)) not in ('sale','refund','chargeback','fee','adjustment') then raise exception 'invalid_journal_type'; end if;
  if p_currency !~ '^[A-Z]{3}$' then raise exception 'invalid_currency'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then raise exception 'journal_lines_required'; end if;
  select user_id into v_tx_user from public.gateway_transactions where id=p_transaction_id;
  if p_transaction_id is not null and (v_tx_user is null or v_tx_user <> p_user_id) then raise exception 'transaction_tenant_mismatch'; end if;
  select user_id into v_gateway_user from public.gateways where id=p_gateway_id;
  if p_gateway_id is not null and (v_gateway_user is null or v_gateway_user <> p_user_id) then raise exception 'gateway_tenant_mismatch'; end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_direction := lower(trim(coalesce(v_line->>'direction','')));
    v_account := trim(coalesce(v_line->>'account_code',''));
    begin v_amount := nullif(v_line->>'amount','')::numeric; exception when others then raise exception 'invalid_journal_line'; end;
    if v_direction not in ('debit','credit') or v_account='' or v_amount is null or v_amount <= 0 then raise exception 'invalid_journal_line'; end if;
    if v_direction='debit' then v_debit := v_debit + v_amount; else v_credit := v_credit + v_amount; end if;
  end loop;
  if round(v_debit,4) <> round(v_credit,4) then raise exception 'unbalanced_journal'; end if;
  insert into public.gateway_financial_journals(user_id,transaction_id,gateway_id,journal_type,source_event_key,currency,metadata)
  values(p_user_id,p_transaction_id,p_gateway_id,lower(trim(p_journal_type)),trim(p_source_event_key),p_currency,coalesce(p_metadata,'{}'::jsonb))
  on conflict (user_id,source_event_key) do update set source_event_key=excluded.source_event_key
  returning id into v_journal;
  if not exists (select 1 from public.gateway_financial_entries where journal_id=v_journal) then
    for v_line in select value from jsonb_array_elements(p_lines) loop
      insert into public.gateway_financial_entries(journal_id,user_id,account_code,direction,amount,currency)
      values(v_journal,p_user_id,trim(v_line->>'account_code'),lower(trim(v_line->>'direction')),(v_line->>'amount')::numeric,p_currency);
    end loop;
  end if;
  return v_journal;
end; $$;
revoke all on function public.post_gateway_financial_journal(uuid,uuid,text,text,text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.post_gateway_financial_journal(uuid,uuid,text,text,text,text,jsonb,jsonb) to service_role;
