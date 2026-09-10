BEGIN;

CREATE OR REPLACE FUNCTION public.rank_gateway_candidates(
  p_user_id uuid,p_gateway_ids text[],p_amount numeric,p_currency text,p_environment text,p_card_brand text
)
RETURNS TABLE(gateway_id text,routing_score numeric,approval_rate numeric,latency_ms integer,healthy boolean,circuit_state text,cost_bps numeric)
LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$
WITH eligible AS (
 SELECT g.id::text gateway_id,g.capabilities,COALESCE(h.is_healthy,true) healthy,COALESCE(h.latency_ms,0) latency_ms,COALESCE(h.circuit_state,'closed') circuit_state,
 CASE WHEN COALESCE(h.circuit_state,'closed')='open' THEN 0 ELSE 1 END circuit_ok
 FROM public.gateways g LEFT JOIN LATERAL (
  SELECT hs.is_healthy,hs.latency_ms,hs.circuit_state FROM public.gateway_health_snapshots hs
  WHERE hs.gateway_id=g.circuit_id ORDER BY hs.checked_at DESC LIMIT 1
 ) h ON true
 WHERE g.user_id=p_user_id AND g.id::text=ANY(p_gateway_ids) AND lower(g.status) IN ('connected','degraded') AND lower(g.environment)=lower(p_environment)
 AND (g.capabilities->'currencies' IS NULL OR jsonb_typeof(g.capabilities->'currencies')<>'array' OR g.capabilities->'currencies' @> to_jsonb(upper(p_currency)))
 AND (g.capabilities->>'min_amount' IS NULL OR g.capabilities->>'min_amount' !~ '^[0-9]+(\.[0-9]+)?$' OR p_amount >= (g.capabilities->>'min_amount')::numeric)
 AND (g.capabilities->>'max_amount' IS NULL OR g.capabilities->>'max_amount' !~ '^[0-9]+(\.[0-9]+)?$' OR p_amount <= (g.capabilities->>'max_amount')::numeric)
), attempts AS (
 SELECT e.gateway_id,count(*) FILTER(WHERE a.status IN ('approved','declined','pending','error'))::numeric total,count(*) FILTER(WHERE a.status='approved')::numeric approved
 FROM eligible e LEFT JOIN public.gateway_payment_attempts a ON a.gateway_id=e.gateway_id AND a.user_id=p_user_id AND a.created_at>=now()-interval '30 days' GROUP BY e.gateway_id
), costs AS (
 SELECT e.gateway_id,COALESCE(public.gateway_effective_cost_bps(p_user_id,e.gateway_id,p_card_brand,p_amount*100),CASE WHEN e.capabilities->>'cost_bps'~'^[0-9]+(\.[0-9]+)?$' THEN (e.capabilities->>'cost_bps')::numeric ELSE 0 END) cost_bps FROM eligible e
), scored AS (
 SELECT e.gateway_id,round((e.circuit_ok*100.0)+(CASE WHEN e.healthy THEN 25 ELSE -35 END)+(CASE WHEN e.latency_ms<=0 THEN 10 WHEN e.latency_ms<=200 THEN 10 WHEN e.latency_ms<=500 THEN 6 WHEN e.latency_ms<=1000 THEN 2 ELSE -10 END)+(CASE WHEN COALESCE(a.total,0)=0 THEN 8 ELSE greatest(-15,least(20,((a.approved/nullif(a.total,0))*20)-5)) END)-(least(15,c.cost_bps/100.0)),4) routing_score,CASE WHEN COALESCE(a.total,0)=0 THEN 1 ELSE round((a.approved/nullif(a.total,0))*100,4) END approval_rate,e.latency_ms,e.healthy,e.circuit_state,c.cost_bps
 FROM eligible e LEFT JOIN attempts a ON a.gateway_id=e.gateway_id LEFT JOIN costs c ON c.gateway_id=e.gateway_id
)
SELECT gateway_id,routing_score,approval_rate,latency_ms,healthy,circuit_state,cost_bps FROM scored WHERE circuit_state<>'open' ORDER BY routing_score DESC,gateway_id ASC;
$$;

CREATE OR REPLACE FUNCTION public.rank_gateway_candidates(p_user_id uuid,p_gateway_ids text[],p_amount numeric,p_currency text,p_environment text)
RETURNS TABLE(gateway_id text,routing_score numeric,approval_rate numeric,latency_ms integer,healthy boolean,circuit_state text,cost_bps numeric)
LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT * FROM public.rank_gateway_candidates(p_user_id,p_gateway_ids,p_amount,p_currency,p_environment,NULL::text); $$;

CREATE OR REPLACE FUNCTION public.gateway_runtime_route_candidates(p_user_id uuid,p_gateway_ids text[],p_amount numeric,p_currency text,p_environment text,p_card_brand text DEFAULT NULL)
RETURNS TABLE(gateway_id text,routing_score numeric,approval_rate numeric,latency_ms integer,healthy boolean,circuit_state text,cost_bps numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
 IF p_user_id IS NULL THEN RAISE EXCEPTION 'gateway_user_required'; END IF;
 IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'gateway_amount_invalid'; END IF;
 IF p_currency IS NULL OR length(p_currency)<>3 THEN RAISE EXCEPTION 'gateway_currency_invalid'; END IF;
 RETURN QUERY SELECT * FROM public.rank_gateway_candidates(p_user_id,p_gateway_ids,p_amount,upper(p_currency),lower(p_environment),p_card_brand);
END; $$;

REVOKE ALL ON FUNCTION public.rank_gateway_candidates(uuid,text[],numeric,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.rank_gateway_candidates(uuid,text[],numeric,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.gateway_runtime_route_candidates(uuid,text[],numeric,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rank_gateway_candidates(uuid,text[],numeric,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rank_gateway_candidates(uuid,text[],numeric,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.gateway_runtime_route_candidates(uuid,text[],numeric,text,text,text) TO service_role;

COMMIT;
