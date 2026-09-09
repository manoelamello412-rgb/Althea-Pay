BEGIN;

CREATE INDEX IF NOT EXISTS idx_crm_webhook_recovery_queue
  ON public.crm_webhook_events(user_id, status, received_at DESC)
  WHERE status IS NOT NULL;

CREATE OR REPLACE FUNCTION public.crm_recovery_opportunities(p_days integer DEFAULT 7)
RETURNS TABLE(
  event_id uuid,
  received_at timestamptz,
  status text,
  transaction_id text,
  buyer_name text,
  buyer_email text,
  funnel_id text,
  product_id text,
  amount numeric,
  currency text,
  priority integer,
  opportunity_type text,
  next_action text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH raw AS (
  SELECT
    e.id AS event_id,
    e.received_at,
    lower(coalesce(e.status,'')) AS event_status,
    e.transaction_id,
    e.buyer_name,
    e.buyer_email,
    nullif(coalesce(e.payload->>'funnel_id',e.payload->>'funnelId'),'') AS funnel_id,
    nullif(coalesce(e.payload->>'product_id',e.payload->>'productId'),'') AS product_id,
    coalesce(e.payload->>'amount',e.payload->>'value',e.payload->>'total',e.payload->'payment'->>'amount',e.payload->'transaction'->>'amount') AS amount_text,
    coalesce(e.payload->>'currency',e.payload->'payment'->>'currency','BRL') AS currency,
    e.processed_at
  FROM public.crm_webhook_events e
  WHERE e.user_id = auth.uid()
    AND e.received_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days,7),30)))
    AND lower(coalesce(e.status,'')) IN ('failed','declined','pending','abandoned','waiting','created')
), base AS (
  SELECT r.*, CASE WHEN r.amount_text ~ '^[+-]?[0-9]+([.,][0-9]+)?$' THEN replace(r.amount_text,',','.')::numeric ELSE NULL END AS amount
  FROM raw r
), scored AS (
  SELECT b.*,
    CASE WHEN b.event_status IN ('failed','declined') THEN 60 WHEN b.event_status IN ('pending','waiting') THEN 50 ELSE 40 END
    + CASE WHEN b.amount IS NOT NULL AND b.amount >= 500 THEN 20 WHEN b.amount IS NOT NULL AND b.amount >= 100 THEN 10 ELSE 0 END
    + CASE WHEN b.buyer_email IS NOT NULL THEN 5 ELSE 0 END
    + CASE WHEN b.received_at >= now() - interval '30 minutes' THEN 15 WHEN b.received_at >= now() - interval '6 hours' THEN 10 WHEN b.received_at >= now() - interval '24 hours' THEN 5 ELSE 0 END AS priority
  FROM base b
)
SELECT s.event_id,s.received_at,s.event_status,s.transaction_id,s.buyer_name,s.buyer_email,s.funnel_id,s.product_id,s.amount,s.currency,least(100,s.priority)::integer,
  CASE WHEN s.event_status IN ('failed','declined') THEN 'payment_failed' WHEN s.event_status IN ('pending','waiting') THEN 'payment_pending' ELSE 'checkout_abandoned' END,
  CASE WHEN s.event_status IN ('failed','declined') THEN 'Recuperar pagamento e oferecer alternativa de pagamento.' WHEN s.event_status IN ('pending','waiting') THEN 'Acompanhar pendência e conduzir o cliente à conclusão.' ELSE 'Retomar a jornada e devolver o cliente ao checkout.' END
FROM scored s WHERE s.processed_at IS NULL ORDER BY s.priority DESC,s.received_at DESC;
$$;

REVOKE ALL ON FUNCTION public.crm_recovery_opportunities(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_recovery_opportunities(integer) TO authenticated;

COMMIT;
