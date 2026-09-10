-- IARA Agent Governance Layer
-- Adds typed tool governance, human approvals and proactive intelligence state.
-- PostgreSQL/Supabase remains authoritative. No Redis state is introduced here.

CREATE TABLE IF NOT EXISTS public.iara_tool_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  risk_class TEXT NOT NULL CHECK (risk_class IN ('read','low','medium','high','critical')),
  permission_code TEXT NOT NULL,
  input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_required BOOLEAN NOT NULL DEFAULT FALSE,
  confirmation_required BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tool_key, version)
);

CREATE INDEX IF NOT EXISTS iara_tool_registry_enabled_idx
  ON public.iara_tool_registry (enabled, risk_class, tool_key);

CREATE TABLE IF NOT EXISTS public.iara_action_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  execution_id UUID,
  tool_key TEXT NOT NULL,
  tool_version INTEGER NOT NULL DEFAULT 1 CHECK (tool_version > 0),
  risk_class TEXT NOT NULL CHECK (risk_class IN ('medium','high','critical')),
  resource_type TEXT,
  resource_id TEXT,
  request_digest TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','consumed','cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, request_digest)
);

CREATE INDEX IF NOT EXISTS iara_action_approvals_user_status_idx
  ON public.iara_action_approvals (user_id, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS iara_action_approvals_execution_idx
  ON public.iara_action_approvals (execution_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.iara_proactive_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','high','critical')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC(5,4) CHECK (confidence >= 0 AND confidence <= 1),
  recommended_action JSONB,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','dismissed')),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS iara_proactive_alerts_user_status_idx
  ON public.iara_proactive_alerts (user_id, status, severity, detected_at DESC);

CREATE INDEX IF NOT EXISTS iara_proactive_alerts_type_idx
  ON public.iara_proactive_alerts (tenant_id, alert_type, detected_at DESC);

ALTER TABLE public.iara_action_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iara_proactive_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS iara_action_approvals_select_own ON public.iara_action_approvals;
CREATE POLICY iara_action_approvals_select_own
  ON public.iara_action_approvals
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND tenant_id = auth.uid());

DROP POLICY IF EXISTS iara_action_approvals_insert_own ON public.iara_action_approvals;
CREATE POLICY iara_action_approvals_insert_own
  ON public.iara_action_approvals
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND tenant_id = auth.uid());

DROP POLICY IF EXISTS iara_action_approvals_update_own ON public.iara_action_approvals;
CREATE POLICY iara_action_approvals_update_own
  ON public.iara_action_approvals
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() AND tenant_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND tenant_id = auth.uid());

DROP POLICY IF EXISTS iara_proactive_alerts_select_own ON public.iara_proactive_alerts;
CREATE POLICY iara_proactive_alerts_select_own
  ON public.iara_proactive_alerts
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND tenant_id = auth.uid());

DROP POLICY IF EXISTS iara_proactive_alerts_update_own ON public.iara_proactive_alerts;
CREATE POLICY iara_proactive_alerts_update_own
  ON public.iara_proactive_alerts
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() AND tenant_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND tenant_id = auth.uid());

-- Tool registry is deliberately not exposed to ordinary authenticated clients.
-- Service-role/backend execution resolves and authorizes tools.
REVOKE ALL ON public.iara_tool_registry FROM anon, authenticated;
GRANT SELECT ON public.iara_tool_registry TO service_role;

REVOKE ALL ON public.iara_action_approvals FROM anon;
REVOKE ALL ON public.iara_proactive_alerts FROM anon;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.iara_proactive_alerts;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.iara_tool_registry IS 'Authoritative registry of IARA tools, risk classes, permissions and schemas.';
COMMENT ON TABLE public.iara_action_approvals IS 'Human approval state for medium/high/critical IARA actions.';
COMMENT ON TABLE public.iara_proactive_alerts IS 'Durable proactive intelligence findings generated from operational evidence.';
