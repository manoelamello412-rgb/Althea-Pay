BEGIN;

CREATE TABLE IF NOT EXISTS public.iara_operational_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_event_id UUID,
  metric TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  observed_value NUMERIC NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT iara_operational_telemetry_source_unique UNIQUE (tenant_id, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_iara_telemetry_metric_window
  ON public.iara_operational_telemetry(tenant_id, metric, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_iara_telemetry_entity_window
  ON public.iara_operational_telemetry(tenant_id, entity_type, entity_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS public.iara_anomalies (
  anomaly_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  execution_id UUID,
  metric TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  observed_value NUMERIC NOT NULL,
  baseline_mean NUMERIC NOT NULL,
  baseline_stddev NUMERIC NOT NULL,
  baseline_sample_count INTEGER NOT NULL CHECK (baseline_sample_count >= 0),
  baseline_window_start TIMESTAMPTZ NOT NULL,
  baseline_window_end TIMESTAMPTZ NOT NULL,
  deviation NUMERIC NOT NULL,
  detection_method TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  confidence NUMERIC NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_observed_at TIMESTAMPTZ NOT NULL,
  last_observed_at TIMESTAMPTZ NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  status TEXT NOT NULL DEFAULT 'DETECTED' CHECK (status IN ('DETECTED','ACKNOWLEDGED','RESOLVED')),
  deduplication_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT iara_anomalies_tenant_dedup_unique UNIQUE (tenant_id, deduplication_key)
);

CREATE INDEX IF NOT EXISTS idx_iara_anomalies_tenant_created
  ON public.iara_anomalies(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iara_anomalies_active
  ON public.iara_anomalies(tenant_id, status, severity, last_observed_at DESC);

CREATE TABLE IF NOT EXISTS public.iara_proactive_alerts (
  alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  execution_id UUID,
  source_type TEXT NOT NULL,
  source_id UUID,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  product_id UUID,
  funnel_id UUID,
  gateway_id UUID,
  headline TEXT NOT NULL,
  explanation TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  estimated_impact NUMERIC,
  impact_confidence NUMERIC CHECK (impact_confidence IS NULL OR (impact_confidence >= 0 AND impact_confidence <= 1)),
  recommended_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  policy_state TEXT NOT NULL DEFAULT 'NOT_ACTIONABLE',
  status TEXT NOT NULL DEFAULT 'DETECTED' CHECK (status IN ('DETECTED','ENRICHED','DISPATCHED','ACKNOWLEDGED','ACTION_PENDING','RESOLVED')),
  deduplication_key TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  first_observed_at TIMESTAMPTZ NOT NULL,
  last_observed_at TIMESTAMPTZ NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT iara_alerts_tenant_dedup_unique UNIQUE (tenant_id, deduplication_key)
);

CREATE INDEX IF NOT EXISTS idx_iara_alerts_tenant_status
  ON public.iara_proactive_alerts(tenant_id, status, severity, created_at DESC);

CREATE TABLE IF NOT EXISTS public.iara_evaluations (
  evaluation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  execution_id UUID,
  evaluator_version TEXT NOT NULL,
  overall_score NUMERIC NOT NULL CHECK (overall_score >= 0 AND overall_score <= 1),
  hallucination_risk NUMERIC NOT NULL CHECK (hallucination_risk >= 0 AND hallucination_risk <= 1),
  grounding_score NUMERIC NOT NULL CHECK (grounding_score >= 0 AND grounding_score <= 1),
  tool_call_accuracy NUMERIC NOT NULL CHECK (tool_call_accuracy >= 0 AND tool_call_accuracy <= 1),
  evidence_coverage NUMERIC NOT NULL CHECK (evidence_coverage >= 0 AND evidence_coverage <= 1),
  causal_confidence NUMERIC NOT NULL CHECK (causal_confidence >= 0 AND causal_confidence <= 1),
  data_confidence NUMERIC NOT NULL CHECK (data_confidence >= 0 AND data_confidence <= 1),
  total_cost_minor BIGINT,
  latency_ms INTEGER,
  decision TEXT NOT NULL CHECK (decision IN ('PASS','REVIEW','BLOCK')),
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iara_evaluations_tenant_created
  ON public.iara_evaluations(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.iara_evaluation_assertions (
  assertion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id UUID NOT NULL REFERENCES public.iara_evaluations(evaluation_id) ON DELETE CASCADE,
  assertion_type TEXT NOT NULL,
  passed BOOLEAN NOT NULL,
  score NUMERIC NOT NULL CHECK (score >= 0 AND score <= 1),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.iara_evaluation_tool_calls (
  tool_call_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id UUID NOT NULL REFERENCES public.iara_evaluations(evaluation_id) ON DELETE CASCADE,
  tool_key TEXT NOT NULL,
  requested_input JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_output JSONB,
  schema_valid BOOLEAN NOT NULL,
  authorized BOOLEAN NOT NULL,
  result_valid BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.iara_operational_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iara_anomalies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iara_proactive_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iara_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iara_evaluation_assertions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iara_evaluation_tool_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS iara_telemetry_select_own ON public.iara_operational_telemetry;
CREATE POLICY iara_telemetry_select_own ON public.iara_operational_telemetry FOR SELECT TO authenticated USING (auth.uid() = tenant_id);
DROP POLICY IF EXISTS iara_anomalies_select_own ON public.iara_anomalies;
CREATE POLICY iara_anomalies_select_own ON public.iara_anomalies FOR SELECT TO authenticated USING (auth.uid() = tenant_id);
DROP POLICY IF EXISTS iara_alerts_select_own ON public.iara_proactive_alerts;
CREATE POLICY iara_alerts_select_own ON public.iara_proactive_alerts FOR SELECT TO authenticated USING (auth.uid() = tenant_id);
DROP POLICY IF EXISTS iara_evaluations_select_own ON public.iara_evaluations;
CREATE POLICY iara_evaluations_select_own ON public.iara_evaluations FOR SELECT TO authenticated USING (auth.uid() = tenant_id);
DROP POLICY IF EXISTS iara_assertions_select_own ON public.iara_evaluation_assertions;
CREATE POLICY iara_assertions_select_own ON public.iara_evaluation_assertions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.iara_evaluations e WHERE e.evaluation_id = evaluation_id AND e.tenant_id = auth.uid()));
DROP POLICY IF EXISTS iara_tool_calls_select_own ON public.iara_evaluation_tool_calls;
CREATE POLICY iara_tool_calls_select_own ON public.iara_evaluation_tool_calls FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.iara_evaluations e WHERE e.evaluation_id = evaluation_id AND e.tenant_id = auth.uid()));

REVOKE ALL ON public.iara_operational_telemetry, public.iara_anomalies, public.iara_proactive_alerts, public.iara_evaluations, public.iara_evaluation_assertions, public.iara_evaluation_tool_calls FROM anon;

COMMIT;
