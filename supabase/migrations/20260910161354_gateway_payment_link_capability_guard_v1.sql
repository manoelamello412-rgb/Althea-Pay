alter table public.gateway_payment_links add constraint gateway_payment_links_amount_currency_chk check(amount>0 and currency ~ '^[A-Z]{3}$');
