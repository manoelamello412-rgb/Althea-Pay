BEGIN;

CREATE TABLE IF NOT EXISTS public.crm_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','busy','offline')),
  last_assigned_at timestamptz NOT NULL DEFAULT '1970-01-01T00:00:00Z'::timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_agents_round_robin ON public.crm_agents(user_id,status,last_assigned_at,id);
ALTER TABLE public.crm_agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_agents_owner_select ON public.crm_agents;
CREATE POLICY crm_agents_owner_select ON public.crm_agents FOR SELECT USING (user_id=auth.uid());

ALTER TABLE public.crm_conversations ADD COLUMN IF NOT EXISTS customer_id text;
ALTER TABLE public.crm_conversations ADD COLUMN IF NOT EXISTS assigned_to uuid;
ALTER TABLE public.crm_conversations ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.crm_conversations ADD COLUMN IF NOT EXISTS public_token text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_conversations_public_token ON public.crm_conversations(public_token) WHERE public_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_conversations_customer ON public.crm_conversations(user_id,customer_id);
CREATE INDEX IF NOT EXISTS idx_crm_conversations_tx ON public.crm_conversations(user_id,transaction_id);

CREATE OR REPLACE FUNCTION public.crm_recovery_execute(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_event public.crm_webhook_events%ROWTYPE; v_agent public.crm_agents%ROWTYPE; v_conv public.crm_conversations%ROWTYPE; v_now timestamptz:=clock_timestamp(); v_lock_key bigint; v_token text; v_assigned uuid; v_name text;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
 SELECT * INTO v_event FROM public.crm_webhook_events WHERE id=p_event_id AND user_id=v_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
 v_lock_key:=hashtextextended(v_user::text||':crm-recovery:'||coalesce(v_event.buyer_email,'')||':'||coalesce(v_event.transaction_id,v_event.id::text),0);
 PERFORM pg_advisory_xact_lock(v_lock_key);
 SELECT * INTO v_agent FROM public.crm_agents WHERE user_id=v_user AND status='available' ORDER BY last_assigned_at ASC,id ASC LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF FOUND THEN v_assigned:=v_agent.id; v_name:=v_agent.name; UPDATE public.crm_agents SET last_assigned_at=v_now WHERE id=v_agent.id; END IF;
 SELECT * INTO v_conv FROM public.crm_conversations WHERE user_id=v_user AND ((v_event.transaction_id IS NOT NULL AND transaction_id=v_event.transaction_id) OR (v_event.buyer_email IS NOT NULL AND lower(buyer_email)=lower(v_event.buyer_email))) ORDER BY updated_at DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN
  v_token:=encode(gen_random_bytes(32),'hex');
  INSERT INTO public.crm_conversations(user_id,funnel_id,product_id,transaction_id,buyer_name,buyer_email,status,assigned_to,metadata,public_token,updated_at)
  VALUES(v_user,NULLIF(coalesce(v_event.payload->>'funnel_id',v_event.payload->>'funnelId'),''),NULLIF(coalesce(v_event.payload->>'product_id',v_event.payload->>'productId'),''),v_event.transaction_id,v_event.buyer_name,v_event.buyer_email,'open',v_assigned,jsonb_build_object('recovery_event_id',v_event.id,'recovery_triggered_at',v_now),v_token,v_now)
  RETURNING * INTO v_conv;
 ELSE
  UPDATE public.crm_conversations SET buyer_name=coalesce(v_event.buyer_name,buyer_name),buyer_email=coalesce(v_event.buyer_email,buyer_email),transaction_id=coalesce(v_event.transaction_id,transaction_id),assigned_to=coalesce(v_assigned,assigned_to),status='open',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('recovery_event_id',v_event.id,'recovery_triggered_at',v_now),updated_at=v_now WHERE id=v_conv.id RETURNING * INTO v_conv;
  v_token:=v_conv.public_token;
 END IF;
 INSERT INTO public.crm_messages(conversation_id,user_id,direction,channel,body,metadata,created_at) VALUES(v_conv.id,v_user,'inbound','system',CASE WHEN v_name IS NULL THEN '[SISTEMA ALTHEA PAY] Recuperação acionada. Lead mantido na fila geral.' ELSE '[SISTEMA ALTHEA PAY] Recuperação acionada. Lead atribuído ao operador: '||v_name||'.' END,jsonb_build_object('event_id',v_event.id,'execution','crm_recovery','assigned_agent_id',v_assigned),v_now);
 UPDATE public.crm_webhook_events SET processed_at=coalesce(processed_at,v_now) WHERE id=v_event.id;
 RETURN jsonb_build_object('success',true,'conversation_id',v_conv.id,'conversation_token',v_token,'assigned_operator',coalesce(v_name,'Fila Geral de Triagem'));
END; $$;

CREATE OR REPLACE FUNCTION public.althea_pay_calculate_tmr(target_user_id uuid)
RETURNS numeric LANGUAGE sql STABLE SET search_path=public AS $$
WITH inbound AS (
 SELECT m.conversation_id,m.created_at,lead(m.created_at) OVER(PARTITION BY m.conversation_id ORDER BY m.created_at) next_inbound_at
 FROM crm_messages m JOIN crm_conversations c ON c.id=m.conversation_id WHERE c.user_id=target_user_id AND m.direction='inbound'
), pairs AS (
 SELECT i.conversation_id,i.created_at AS inbound_at,min(o.created_at) response_at
 FROM inbound i JOIN crm_messages o ON o.conversation_id=i.conversation_id AND o.direction='outbound' AND o.created_at>i.created_at AND (i.next_inbound_at IS NULL OR o.created_at<i.next_inbound_at)
 GROUP BY i.conversation_id,i.created_at
)
SELECT round(coalesce(avg(extract(epoch FROM(response_at-inbound_at))/60.0),0)::numeric,1) FROM pairs WHERE response_at IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.crm_analytics(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
WITH bounds AS(SELECT greatest(1,least(p_days,365))::integer d), c AS(SELECT crm_conversations.* FROM crm_conversations,bounds WHERE user_id=auth.uid() AND created_at>=now()-make_interval(days=>bounds.d)), e AS(SELECT crm_webhook_events.* FROM crm_webhook_events,bounds WHERE user_id=auth.uid() AND received_at>=now()-make_interval(days=>bounds.d)), s AS(SELECT sales.* FROM sales,bounds WHERE user_id=auth.uid() AND coalesce(occurred_at,created_at)>=now()-make_interval(days=>bounds.d))
SELECT jsonb_build_object('timeframe_days',(SELECT d FROM bounds),'operation',jsonb_build_object('total_conversations',(SELECT count(*) FROM c),'open',(SELECT count(*) FROM c WHERE status='open'),'pending',(SELECT count(*) FROM c WHERE status='pending'),'closed',(SELECT count(*) FROM c WHERE status='closed'),'average_response_time_minutes',public.althea_pay_calculate_tmr(auth.uid())),'financial',jsonb_build_object('approved_sales_count',(SELECT count(*) FROM s WHERE lower(coalesce(status,''))='approved'),'approved_revenue',(SELECT coalesce(sum(amount),0) FROM s WHERE lower(coalesce(status,''))='approved'),'approved_event_count',(SELECT count(*) FROM e WHERE upper(coalesce(status,''))='APPROVED')),'events',jsonb_build_object('total',(SELECT count(*) FROM e),'failed',(SELECT count(*) FROM e WHERE lower(coalesce(status,'')) IN('failed','declined')),'pending',(SELECT count(*) FROM e WHERE lower(coalesce(status,''))='pending')));
$$;
REVOKE ALL ON FUNCTION public.crm_recovery_execute(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_recovery_execute(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.crm_analytics(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_analytics(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.althea_pay_calculate_tmr(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.althea_pay_calculate_tmr(uuid) TO authenticated;
COMMIT;
