revoke execute on function public.materialize_gateway_customer_identity(uuid) from public, anon, authenticated;
revoke execute on function public.project_gateway_payment_link_sale() from public, anon, authenticated;
grant execute on function public.materialize_gateway_customer_identity(uuid) to postgres, service_role;
grant execute on function public.project_gateway_payment_link_sale() to postgres, service_role;
