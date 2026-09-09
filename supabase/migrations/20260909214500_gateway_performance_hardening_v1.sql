-- Gateway performance hardening: cache auth.uid() per statement in routing-policy RLS
-- and remove the duplicate payment-attempt sale index.

drop index if exists public.gateway_attempts_user_sale_idx;

alter policy gateway_routing_policies_select_own
  on public.gateway_routing_policies
  using (user_id = (select auth.uid()));

alter policy gateway_routing_policies_insert_own
  on public.gateway_routing_policies
  with check (user_id = (select auth.uid()));

alter policy gateway_routing_policies_update_own
  on public.gateway_routing_policies
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy gateway_routing_policies_delete_own
  on public.gateway_routing_policies
  using (user_id = (select auth.uid()));
