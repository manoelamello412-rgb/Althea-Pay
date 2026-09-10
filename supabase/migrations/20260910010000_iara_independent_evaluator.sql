create table if not exists public.iara_evaluation_claims (
  claim_id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.iara_evaluations(evaluation_id) on delete cascade,
  claim text not null,
  claim_type text not null check (claim_type in ('FACT','NUMERIC','TEMPORAL','CAUSAL','INFERENCE','RECOMMENDATION')),
  verified boolean not null,
  score numeric(6,5) not null check (score >= 0 and score <= 1),
  evidence jsonb not null default '[]'::jsonb,
  freshness_seconds integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_iara_evaluation_claims_evaluation
  on public.iara_evaluation_claims(evaluation_id);

create table if not exists public.iara_evaluation_failures (
  failure_id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.iara_evaluations(evaluation_id) on delete cascade,
  failure_code text not null,
  severity text not null check (severity in ('LOW','MEDIUM','HIGH','CRITICAL')),
  message text not null,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_iara_evaluation_failures_evaluation
  on public.iara_evaluation_failures(evaluation_id);

alter table public.iara_evaluation_claims enable row level security;
alter table public.iara_evaluation_failures enable row level security;

create or replace function public.persist_iara_independent_evaluation(
  p_tenant_id uuid,
  p_execution_id uuid,
  p_evaluator_version text,
  p_overall_score numeric,
  p_hallucination_risk numeric,
  p_grounding_score numeric,
  p_tool_call_accuracy numeric,
  p_evidence_coverage numeric,
  p_causal_confidence numeric,
  p_data_confidence numeric,
  p_total_cost_minor bigint,
  p_latency_ms integer,
  p_decision text,
  p_summary text,
  p_assertions jsonb,
  p_claims jsonb,
  p_failures jsonb,
  p_tool_calls jsonb
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_evaluation_id uuid;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id is required';
  end if;

  if p_decision not in ('PASS','REVIEW','BLOCK') then
    raise exception 'invalid evaluation decision';
  end if;

  insert into public.iara_evaluations (
    tenant_id, execution_id, evaluator_version, overall_score,
    hallucination_risk, grounding_score, tool_call_accuracy,
    evidence_coverage, causal_confidence, data_confidence,
    total_cost_minor, latency_ms, decision, summary
  ) values (
    p_tenant_id, p_execution_id, p_evaluator_version, p_overall_score,
    p_hallucination_risk, p_grounding_score, p_tool_call_accuracy,
    p_evidence_coverage, p_causal_confidence, p_data_confidence,
    p_total_cost_minor, p_latency_ms, p_decision, p_summary
  ) returning evaluation_id into v_evaluation_id;

  insert into public.iara_evaluation_assertions (evaluation_id, assertion_type, passed, score, evidence)
  select v_evaluation_id, x.assertion_type, x.passed, x.score, x.evidence
  from jsonb_to_recordset(coalesce(p_assertions, '[]'::jsonb)) as x(
    assertion_type text, passed boolean, score numeric, evidence jsonb
  );

  insert into public.iara_evaluation_claims (evaluation_id, claim, claim_type, verified, score, evidence, freshness_seconds)
  select v_evaluation_id, x.claim, x.claim_type, x.verified, x.score, x.evidence, x.freshness_seconds
  from jsonb_to_recordset(coalesce(p_claims, '[]'::jsonb)) as x(
    claim text, claim_type text, verified boolean, score numeric, evidence jsonb, freshness_seconds integer
  );

  insert into public.iara_evaluation_failures (evaluation_id, failure_code, severity, message, evidence)
  select v_evaluation_id, x.failure_code, x.severity, x.message, x.evidence
  from jsonb_to_recordset(coalesce(p_failures, '[]'::jsonb)) as x(
    failure_code text, severity text, message text, evidence jsonb
  );

  insert into public.iara_evaluation_tool_calls (
    evaluation_id, tool_key, requested_input, observed_output,
    schema_valid, authorized, result_valid
  )
  select v_evaluation_id, x.tool_key, x.requested_input, x.observed_output,
         x.schema_valid, x.authorized, x.result_valid
  from jsonb_to_recordset(coalesce(p_tool_calls, '[]'::jsonb)) as x(
    tool_key text, requested_input jsonb, observed_output jsonb,
    schema_valid boolean, authorized boolean, result_valid boolean
  );

  return v_evaluation_id;
end;
$$;

revoke all on function public.persist_iara_independent_evaluation(uuid, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, bigint, integer, text, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
