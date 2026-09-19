revoke all on function public.provision_sandbox_gateway(text) from public;
revoke all on function public.provision_sandbox_gateway(text) from anon;
revoke all on function public.provision_sandbox_gateway(text) from authenticated;
drop function if exists public.provision_sandbox_gateway(text);
