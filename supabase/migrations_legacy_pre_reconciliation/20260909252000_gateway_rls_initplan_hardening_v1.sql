drop policy if exists gateway_payment_instruments_owner_select on public.gateway_payment_instruments;
create policy gateway_payment_instruments_owner_select
on public.gateway_payment_instruments
for select
using (user_id = (select auth.uid()));

drop policy if exists gateway_payment_token_links_owner_select on public.gateway_payment_token_links;
create policy gateway_payment_token_links_owner_select
on public.gateway_payment_token_links
for select
using (user_id = (select auth.uid()));
