alter table public.iara_financial_confirmations
  alter column gateway_id type text using gateway_id::text;
