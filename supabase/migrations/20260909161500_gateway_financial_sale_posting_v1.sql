create or replace function public.post_gateway_sale_journal() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='approved' and coalesce(old.status,'')<>'approved' then
    perform public.post_gateway_financial_journal(
      new.user_id,new.id,new.gateway_id,'sale',
      'gateway_transaction:'||new.id::text||':approved:'||new.version::text,
      upper(new.currency),
      jsonb_build_array(
        jsonb_build_object('account_code','gateway_receivable','direction','debit','amount',new.amount),
        jsonb_build_object('account_code','merchant_sales','direction','credit','amount',new.amount)
      ),
      jsonb_build_object('source','gateway_transaction_status','transaction_version',new.version)
    );
  end if;
  return new;
end; $$;
revoke all on function public.post_gateway_sale_journal() from public;
create or replace trigger trg_gateway_transaction_sale_ledger
after update of status on public.gateway_transactions
for each row execute function public.post_gateway_sale_journal();
