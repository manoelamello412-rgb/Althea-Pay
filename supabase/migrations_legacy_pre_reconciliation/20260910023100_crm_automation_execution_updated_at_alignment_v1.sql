ALTER TABLE public.automation_executions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.crm_touch_automation_execution_updated_at()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  new.updated_at=now();
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_crm_touch_automation_execution_updated_at ON public.automation_executions;
CREATE TRIGGER trg_crm_touch_automation_execution_updated_at
BEFORE UPDATE ON public.automation_executions
FOR EACH ROW EXECUTE FUNCTION public.crm_touch_automation_execution_updated_at();
