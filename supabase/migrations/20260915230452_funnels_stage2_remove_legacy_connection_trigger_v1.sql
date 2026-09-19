begin;
drop trigger if exists trg_ensure_funnel_connection on public.funnels;
drop function if exists public.ensure_funnel_connection();
commit;