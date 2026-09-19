alter function public.dashboard_production_data_for_user_secure(date,date,text,text,text,text,text,text,text,text) security definer;
alter function public.dashboard_production_data_for_user_secure(date,date,text,text,text,text,text,text,text,text) set search_path = public;
revoke all on function public.dashboard_production_data_for_user(date,date,text,text,text,text,text,text,text,text) from public;
revoke execute on function public.dashboard_production_data_for_user(date,date,text,text,text,text,text,text,text,text) from authenticated;
grant execute on function public.dashboard_production_data_for_user_secure(date,date,text,text,text,text,text,text,text,text) to authenticated;