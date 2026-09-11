BEGIN;

ALTER TABLE public.crm_ai_actions
  ADD CONSTRAINT crm_ai_actions_execution_id_unique UNIQUE (execution_id);

ALTER TABLE public.iara_evaluations
  ADD CONSTRAINT iara_evaluations_execution_id_fkey
  FOREIGN KEY (execution_id)
  REFERENCES public.crm_ai_actions(execution_id);

COMMIT;
