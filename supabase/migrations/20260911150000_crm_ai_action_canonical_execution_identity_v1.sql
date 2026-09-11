BEGIN;

ALTER TABLE public.crm_ai_actions
  ADD COLUMN IF NOT EXISTS execution_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS crm_ai_actions_execution_id_uidx
  ON public.crm_ai_actions(execution_id)
  WHERE execution_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.crm_execute_ai_action(p_action_id uuid, p_body text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  uid uuid:=auth.uid();
  a public.crm_ai_actions%rowtype;
  m public.crm_messages%rowtype;
  body text:=btrim(coalesce(p_body,''));
  v_execution_id uuid;
begin
  if uid is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if body='' then raise exception 'MESSAGE_EMPTY' using errcode='22023'; end if;
  if length(body)>10000 then raise exception 'MESSAGE_TOO_LONG' using errcode='22001'; end if;

  select * into a from public.crm_ai_actions
  where id=p_action_id and user_id=uid and status='accepted' for update;
  if not found then raise exception 'AI_ACTION_NOT_EXECUTABLE' using errcode='P0001'; end if;
  if a.action_type not in ('payment_follow_up','sales_follow_up','recovery_follow_up','qualification','upsell_or_post_sale') then
    raise exception 'ACTION_NOT_EXECUTABLE' using errcode='P0001';
  end if;

  if a.execution_id is null then
    v_execution_id:=gen_random_uuid();
    update public.crm_ai_actions
      set execution_id=v_execution_id, status='executing'
      where id=a.id and status='accepted';
    if not found then raise exception 'AI_ACTION_NOT_EXECUTABLE' using errcode='P0001'; end if;
    a.execution_id:=v_execution_id;
  else
    v_execution_id:=a.execution_id;
    update public.crm_ai_actions set status='executing' where id=a.id and status='accepted';
    if not found then raise exception 'AI_ACTION_NOT_EXECUTABLE' using errcode='P0001'; end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(a.conversation_id::text,0));
  if not exists(select 1 from public.crm_conversations where id=a.conversation_id and user_id=uid) then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode='P0002';
  end if;

  select * into m from public.crm_messages
  where user_id=uid and client_message_id=('ai:'||a.id) limit 1;
  if not found then
    select * into m from public.crm_operator_send_message(a.conversation_id,body,'ai:'||a.id);
  end if;

  update public.crm_ai_actions set status='executed',executed_at=now()
  where id=a.id and status='executing';

  return jsonb_build_object(
    'ok',true,
    'action_id',a.id,
    'execution_id',v_execution_id,
    'status','executed',
    'executed_at',now(),
    'message',to_jsonb(m)
  );
exception when others then
  update public.crm_ai_actions set status='accepted' where id=a.id and status='executing';
  raise;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.crm_execute_ai_action(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.persist_iara_independent_evaluation(
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
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_evaluation_id uuid;
begin
  if p_tenant_id is null then raise exception 'tenant_id is required'; end if;
  if p_execution_id is null then raise exception 'execution_id is required'; end if;
  if not exists (
    select 1 from public.crm_ai_actions a
    where a.execution_id=p_execution_id and a.user_id=p_tenant_id
  ) then raise exception 'EXECUTION_NOT_FOUND_OR_TENANT_MISMATCH'; end if;
  if p_decision not in ('PASS','REVIEW','BLOCK') then raise exception 'invalid evaluation decision'; end if;

  insert into public.iara_evaluations (
    tenant_id, execution_id, evaluator_version, overall_score, hallucination_risk,
    grounding_score, tool_call_accuracy, evidence_coverage, causal_confidence,
    data_confidence, total_cost_minor, latency_ms, decision, summary
  ) values (
    p_tenant_id, p_execution_id, p_evaluator_version, p_overall_score, p_hallucination_risk,
    p_grounding_score, p_tool_call_accuracy, p_evidence_coverage, p_causal_confidence,
    p_data_confidence, p_total_cost_minor, p_latency_ms, p_decision, p_summary
  ) returning evaluation_id into v_evaluation_id;

  insert into public.iara_evaluation_assertions (evaluation_id, assertion_type, passed, score, evidence)
  select v_evaluation_id, x.assertion_type, x.passed, x.score, x.evidence
  from jsonb_to_recordset(coalesce(p_assertions, '[]'::jsonb)) x(assertion_type text, passed boolean, score numeric, evidence jsonb);

  insert into public.iara_evaluation_claims (evaluation_id, claim, claim_type, verified, score, evidence, freshness_seconds)
  select v_evaluation_id, x.claim, x.claim_type, x.verified, x.score, x.evidence, x.freshness_seconds
  from jsonb_to_recordset(coalesce(p_claims, '[]'::jsonb)) x(claim text, claim_type text, verified boolean, score numeric, evidence jsonb, freshness_seconds integer);

  insert into public.iara_evaluation_failures (evaluation_id, failure_code, severity, message, evidence)
  select v_evaluation_id, x.failure_code, x.severity, x.message, x.evidence
  from jsonb_to_recordset(coalesce(p_failures, '[]'::jsonb)) x(failure_code text, severity text, message text, evidence jsonb);

  insert into public.iara_evaluation_tool_calls (evaluation_id, tool_key, requested_input, observed_output, schema_valid, authorized, result_valid)
  select v_evaluation_id, x.tool_key, x.requested_input, x.observed_output, x.schema_valid, x.authorized, x.result_valid
  from jsonb_to_recordset(coalesce(p_tool_calls, '[]'::jsonb)) x(tool_key text, requested_input jsonb, observed_output jsonb, schema_valid boolean, authorized boolean, result_valid boolean);

  return v_evaluation_id;
end;
$function$;

COMMIT;
