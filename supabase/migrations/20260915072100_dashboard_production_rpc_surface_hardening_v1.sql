alter function public.dashboard_production_data_for_user_secure(date,date,text,text,text,text,text,text,text,text) security invoker;
alter function public.dashboard_production_data_for_user_secure(date,date,text,text,text,text,text,text,text,text) set search_path = public;
grant execute on function public.dashboard_production_data_for_user(date,date,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.dashboard_production_data_for_user_secure(date,date,text,text,text,text,text,text,text,text) to authenticated;