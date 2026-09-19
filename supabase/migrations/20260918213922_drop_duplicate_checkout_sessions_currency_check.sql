
-- checkout_sessions tinha dois CHECK constraints idênticos validando o mesmo regex de moeda ISO-3.
-- Mantido checkout_sessions_currency_iso3 (nome consistente com gateway_transactions_currency_iso3),
-- removido o duplicado checkout_sessions_currency_format.
alter table public.checkout_sessions
  drop constraint checkout_sessions_currency_format;
