revoke all on function public.platform_release_ready() from public;
revoke all on function public.platform_release_ready() from anon;
revoke all on function public.platform_release_ready() from authenticated;
grant execute on function public.platform_release_ready() to service_role;
