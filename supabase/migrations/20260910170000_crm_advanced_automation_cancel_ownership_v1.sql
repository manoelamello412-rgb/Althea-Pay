CREATE OR REPLACE FUNCTION public.crm_cancel_automation_execution(p_execution_id uuid, p_reason text DEFAULT NULL::text)
RETURNS public.automation_executions
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare r public.automation_executions;
begin
  update public.automation_executions
  set status='cancelled', cancelled_at=now(), cancellation_reason=left(coalesce(p_reason,'manual cancellation'),1000), next_retry_at=null, scheduled_at=null
  where id=p_execution_id and user_id=auth.uid() and status in ('pending','scheduled','failed') and dead_lettered_at is null
  returning * into r;
  return r;
end;
$function$;
REVOKE ALL ON FUNCTION public.crm_cancel_automation_execution(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_cancel_automation_execution(uuid,text) TO authenticated;
