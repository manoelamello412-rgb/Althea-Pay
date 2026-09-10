CREATE TABLE IF NOT EXISTS public.iara_execution_idempotency (
  idempotency_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  tool_key TEXT NOT NULL,
  tool_version INTEGER NOT NULL CHECK (tool_version > 0),
  request_hash TEXT NOT NULL,
  execution_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT iara_execution_idempotency_unique UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT iara_execution_idempotency_status_consistency CHECK (
    (status = 'RUNNING' AND completed_at IS NULL)
    OR (status IN ('COMPLETED', 'FAILED') AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_iara_execution_idempotency_execution
  ON public.iara_execution_idempotency (tenant_id, execution_id);

ALTER TABLE public.iara_execution_idempotency ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.iara_execution_idempotency_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id <> OLD.tenant_id
       OR NEW.idempotency_key <> OLD.idempotency_key
       OR NEW.tool_key <> OLD.tool_key
       OR NEW.tool_version <> OLD.tool_version
       OR NEW.request_hash <> OLD.request_hash
       OR NEW.execution_id <> OLD.execution_id
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'IARA idempotency identity fields are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_iara_execution_idempotency_guard
  ON public.iara_execution_idempotency;

CREATE TRIGGER trg_iara_execution_idempotency_guard
BEFORE UPDATE ON public.iara_execution_idempotency
FOR EACH ROW EXECUTE FUNCTION public.iara_execution_idempotency_guard();

REVOKE ALL ON public.iara_execution_idempotency FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.iara_execution_idempotency TO service_role;
