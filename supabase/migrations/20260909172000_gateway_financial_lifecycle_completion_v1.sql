create or replace function public.post_gateway_chargeback_financial_journal()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.status in ('chargeback','charged_back','lost')
     and (tg_op='INSERT' or old.status is distinct from new.status) then
    perform public.post_gateway_financial_journal(
      new.user_id,
      new.transaction_id,
      new.gateway_id,
      'chargeback',
      'chargeback:'||new.id::text,
      new.currency,
      jsonb_build_array(
        jsonb_build_object('account_code','merchant_chargebacks','direction','debit','amount',new.amount),
        jsonb_build_object('account_code','gateway_receivable','direction','credit','amount',new.amount)
      ),
      jsonb_build_object('source','dispute','dispute_id',new.id,'external_dispute_id',new.external_dispute_id,'reason',new.reason)
    );
  end if;
  return new;
end
$$;

drop trigger if exists trg_gateway_chargeback_financial_posting on public.disputes;
create trigger trg_gateway_chargeback_financial_posting
after insert or update of status on public.disputes
for each row execute function public.post_gateway_chargeback_financial_journal();

create or replace function public.post_gateway_settlement_financial_journal()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.status in ('settled','paid','completed','reconciled')
     and (tg_op='INSERT' or old.status is distinct from new.status) then
    perform public.post_gateway_financial_journal(
      new.user_id,
      null,
      new.gateway_id,
      'settlement',
      'settlement:'||new.id::text,
      new.currency,
      jsonb_build_array(
        jsonb_build_object('account_code','cash_settlement','direction','debit','amount',new.net_total),
        jsonb_build_object('account_code','gateway_fees','direction','debit','amount',new.fees_total),
        jsonb_build_object('account_code','gateway_receivable','direction','credit','amount',new.gross_total)
      ),
      jsonb_build_object('source','settlement','settlement_id',new.id,'external_settlement_id',new.external_settlement_id,'gross_total',new.gross_total,'fees_total',new.fees_total,'net_total',new.net_total)
    );
  end if;
  return new;
end
$$;

drop trigger if exists trg_gateway_settlement_financial_posting on public.settlements;
create trigger trg_gateway_settlement_financial_posting
after insert or update of status on public.settlements
for each row execute function public.post_gateway_settlement_financial_journal();

revoke execute on function public.post_gateway_chargeback_financial_journal() from public,anon,authenticated;
revoke execute on function public.post_gateway_settlement_financial_journal() from public,anon,authenticated;
