revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.handle_new_user() from public;
grant execute on function public.handle_new_user() to postgres;