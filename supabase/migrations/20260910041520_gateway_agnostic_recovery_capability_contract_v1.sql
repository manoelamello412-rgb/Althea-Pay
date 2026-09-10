-- ALTHEA PAY — canonical agnostic recovery/capability contract
-- Extends existing canonical tables only. No gateway is seeded or connected.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recovery_state') THEN
    CREATE TYPE public.recovery_state AS ENUM ('UNKNOWN','RECOVERY','STATUS_CHECK','APPROVED','DECLINED','PENDING','DEAD_LETTER');
  END IF;
END $$;
ALTER TABLE public.gateway_recovery_queue ADD COLUMN IF NOT EXISTS recovery_state public.recovery_state, ADD COLUMN IF NOT EXISTS state_version bigint NOT NULL DEFAULT 1, ADD COLUMN IF NOT EXISTS execution_logs jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE public.gateway_recovery_queue SET recovery_state = CASE WHEN status='resolved' THEN 'APPROVED'::public.recovery_state WHEN status='dead_letter' THEN 'DEAD_LETTER'::public.recovery_state WHEN status='processing' THEN 'STATUS_CHECK'::public.recovery_state WHEN status='not_found' THEN 'PENDING'::public.recovery_state ELSE 'RECOVERY'::public.recovery_state END WHERE recovery_state IS NULL;
ALTER TABLE public.gateway_recovery_queue ALTER COLUMN recovery_state SET DEFAULT 'RECOVERY'::public.recovery_state, ALTER COLUMN recovery_state SET NOT NULL;
ALTER TABLE public.gateway_recovery_queue ADD CONSTRAINT gateway_recovery_queue_state_version_positive_ck CHECK (state_version > 0), ADD CONSTRAINT gateway_recovery_queue_execution_logs_array_ck CHECK (jsonb_typeof(execution_logs)='array');
CREATE INDEX IF NOT EXISTS idx_gateway_recovery_queue_state_execution ON public.gateway_recovery_queue(user_id,recovery_state,next_retry_at,created_at) WHERE recovery_state IN ('UNKNOWN','RECOVERY','STATUS_CHECK','PENDING');
ALTER TABLE public.gateway_provider_registry ADD COLUMN IF NOT EXISTS adapter_contract_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.gateway_provider_registry ADD CONSTRAINT gateway_provider_registry_capabilities_object_ck CHECK (jsonb_typeof(capabilities)='object'), ADD CONSTRAINT gateway_provider_registry_adapter_contract_positive_ck CHECK (adapter_contract_version > 0);
CREATE INDEX IF NOT EXISTS idx_gateway_provider_registry_operational_adapter ON public.gateway_provider_registry(operational,adapter_key) WHERE is_active=true;
