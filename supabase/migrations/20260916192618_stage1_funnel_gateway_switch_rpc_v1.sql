begin;

-- Reconciled from the deployed Supabase contract and the historical
-- commercial-view RLS hardening commit. This version exists in the remote
-- migration history and must remain present locally to prevent migration drift.

alter view public.v_funnel_commercial_context
  set (security_invoker = true);

create or replace function public.switch_funnel_gateway(
  p_funnel_id text,
  p_gateway_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  result jsonb;
begin
  result := public.bind_funnel_gateway(
    p_funnel_id,
    p_gateway_id,
    'payment',
    0,
    true
  );
  return result;
exception when others then
  raise;
end;
$function$;

revoke all on function public.switch_funnel_gateway(text,text) from public, anon;
grant execute on function public.switch_funnel_gateway(text,text) to authenticated;

commit;
