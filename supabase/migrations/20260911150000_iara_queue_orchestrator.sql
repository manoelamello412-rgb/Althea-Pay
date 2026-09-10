BEGIN;

CREATE EXTENSION IF NOT EXISTS pgmq;

SELECT pgmq.create('iara-telemetry-process') WHERE NOT EXISTS (SELECT 1 FROM pgmq.list_queues() WHERE queue_name = 'iara-telemetry-process');
SELECT pgmq.create('iara-crm-injection') WHERE NOT EXISTS (SELECT 1 FROM pgmq.list_queues() WHERE queue_name = 'iara-crm-injection');
SELECT pgmq.create('iara-financial-pix-retry') WHERE NOT EXISTS (SELECT 1 FROM pgmq.list_queues() WHERE queue_name = 'iara-financial-pix-retry');
SELECT pgmq.create('iara-dead-letter') WHERE NOT EXISTS (SELECT 1 FROM pgmq.list_queues() WHERE queue_name = 'iara-dead-letter');

CREATE TABLE IF NOT EXISTS public.iara_queue_jobs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL,
  queue_type TEXT NOT NULL CHECK (queue_type IN ('TELEMETRY_PROCESS','CRM_INJECTION','FINANCIAL_PIX_RETRY')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts_made INTEGER NOT NULL DEFAULT 0 CHECK (attempts_made >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','PROCESSING','COMPLETED','RETRYING','DEAD_LETTER')),
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT iara_queue_job_idempotency_unique UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_iara_queue_jobs_tenant_status_created ON public.iara_queue_jobs(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iara_queue_jobs_queue_status ON public.iara_queue_jobs(queue_type, status, created_at ASC);

CREATE TABLE IF NOT EXISTS public.iara_queue_dead_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.iara_queue_jobs(id) ON DELETE RESTRICT,
  tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  queue_type TEXT NOT NULL,
  attempts_made INTEGER NOT NULL,
  payload JSONB NOT NULL,
  error_code TEXT,
  error_message TEXT,
  quarantined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT iara_queue_dlq_job_unique UNIQUE (job_id)
);

CREATE INDEX IF NOT EXISTS idx_iara_queue_dlq_tenant_quarantined ON public.iara_queue_dead_letters(tenant_id, quarantined_at DESC);

ALTER TABLE public.iara_queue_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iara_queue_dead_letters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS iara_queue_jobs_select_own ON public.iara_queue_jobs;
CREATE POLICY iara_queue_jobs_select_own ON public.iara_queue_jobs FOR SELECT TO authenticated USING (tenant_id = auth.uid());
DROP POLICY IF EXISTS iara_queue_dlq_select_own ON public.iara_queue_dead_letters;
CREATE POLICY iara_queue_dlq_select_own ON public.iara_queue_dead_letters FOR SELECT TO authenticated USING (tenant_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.iara_queue_jobs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.iara_queue_dead_letters FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.iara_enqueue_job(p_tenant_id UUID,p_job_id UUID,p_idempotency_key UUID,p_queue_type TEXT,p_payload JSONB,p_max_attempts INTEGER,p_queue_name TEXT)
RETURNS TABLE(job_id UUID,message_id BIGINT,duplicate BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pgmq AS $$
DECLARE v_existing public.iara_queue_jobs; v_message_id BIGINT;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_tenant_id IS NULL OR p_job_id IS NULL OR p_idempotency_key IS NULL THEN RAISE EXCEPTION 'invalid_queue_identity'; END IF;
  IF p_queue_type NOT IN ('TELEMETRY_PROCESS','CRM_INJECTION','FINANCIAL_PIX_RETRY') THEN RAISE EXCEPTION 'invalid_queue_type'; END IF;
  IF p_max_attempts < 1 OR p_max_attempts > 20 THEN RAISE EXCEPTION 'invalid_max_attempts'; END IF;
  SELECT * INTO v_existing FROM public.iara_queue_jobs WHERE tenant_id=p_tenant_id AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    SELECT msg_id INTO v_message_id FROM pgmq.q_iara_telemetry_process WHERE message->>'jobId'=v_existing.id::text
    UNION ALL SELECT msg_id FROM pgmq.q_iara_crm_injection WHERE message->>'jobId'=v_existing.id::text
    UNION ALL SELECT msg_id FROM pgmq.q_iara_financial_pix_retry WHERE message->>'jobId'=v_existing.id::text LIMIT 1;
    RETURN QUERY SELECT v_existing.id,COALESCE(v_message_id,0),true; RETURN;
  END IF;
  INSERT INTO public.iara_queue_jobs(id,tenant_id,idempotency_key,queue_type,payload,max_attempts)
  VALUES(p_job_id,p_tenant_id,p_idempotency_key,p_queue_type,COALESCE(p_payload,'{}'::jsonb),p_max_attempts);
  SELECT pgmq.send(p_queue_name,jsonb_build_object('jobId',p_job_id,'tenantId',p_tenant_id,'type',p_queue_type,'payload',COALESCE(p_payload,'{}'::jsonb),'attemptsMade',0,'maxAttempts',p_max_attempts,'enqueuedAt',now())) INTO v_message_id;
  RETURN QUERY SELECT p_job_id,v_message_id,false;
END;
$$;

CREATE OR REPLACE FUNCTION public.iara_claim_queue_jobs(p_queue_name TEXT,p_visibility_timeout_seconds INTEGER,p_batch_size INTEGER)
RETURNS SETOF pgmq.message_record LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pgmq AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_visibility_timeout_seconds < 1 OR p_visibility_timeout_seconds > 900 THEN RAISE EXCEPTION 'invalid_visibility_timeout'; END IF;
  IF p_batch_size < 1 OR p_batch_size > 100 THEN RAISE EXCEPTION 'invalid_batch_size'; END IF;
  RETURN QUERY SELECT * FROM pgmq.read(p_queue_name,p_visibility_timeout_seconds,p_batch_size);
END;
$$;

CREATE OR REPLACE FUNCTION public.iara_complete_queue_job(p_queue_name TEXT,p_message_id BIGINT,p_job_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pgmq AS $$
DECLARE v_deleted BOOLEAN;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.iara_queue_jobs SET status='COMPLETED',completed_at=now(),updated_at=now() WHERE id=p_job_id AND status IN ('QUEUED','PROCESSING','RETRYING');
  SELECT pgmq.archive(p_queue_name,p_message_id) INTO v_deleted;
  RETURN COALESCE(v_deleted,false);
END;
$$;

CREATE OR REPLACE FUNCTION public.iara_retry_queue_job(p_queue_name TEXT,p_message_id BIGINT,p_job_id UUID,p_next_attempt INTEGER,p_delay_seconds INTEGER,p_error_code TEXT,p_error_message TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pgmq AS $$
DECLARE v_job public.iara_queue_jobs; v_new_message_id BIGINT; v_archived BOOLEAN;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO v_job FROM public.iara_queue_jobs WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_job_not_found'; END IF;
  IF p_next_attempt >= v_job.max_attempts THEN RAISE EXCEPTION 'max_attempts_reached'; END IF;
  IF p_delay_seconds < 0 OR p_delay_seconds > 86400 THEN RAISE EXCEPTION 'invalid_retry_delay'; END IF;
  SELECT pgmq.send(p_queue_name,jsonb_build_object('jobId',v_job.id,'tenantId',v_job.tenant_id,'type',v_job.queue_type,'payload',v_job.payload,'attemptsMade',p_next_attempt,'maxAttempts',v_job.max_attempts,'enqueuedAt',v_job.created_at),p_delay_seconds) INTO v_new_message_id;
  UPDATE public.iara_queue_jobs SET attempts_made=p_next_attempt,status='RETRYING',last_error_code=left(p_error_code,200),last_error_message=left(p_error_message,1000),updated_at=now() WHERE id=p_job_id;
  SELECT pgmq.archive(p_queue_name,p_message_id) INTO v_archived;
  RETURN COALESCE(v_archived,false) AND v_new_message_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.iara_dead_letter_queue_job(p_queue_name TEXT,p_message_id BIGINT,p_job_id UUID,p_error_code TEXT,p_error_message TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pgmq AS $$
DECLARE v_job public.iara_queue_jobs; v_dlq_message_id BIGINT; v_archived BOOLEAN;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO v_job FROM public.iara_queue_jobs WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_job_not_found'; END IF;
  INSERT INTO public.iara_queue_dead_letters(job_id,tenant_id,queue_type,attempts_made,payload,error_code,error_message)
  VALUES(v_job.id,v_job.tenant_id,v_job.queue_type,v_job.attempts_made,v_job.payload,left(p_error_code,200),left(p_error_message,1000)) ON CONFLICT (job_id) DO NOTHING;
  SELECT pgmq.send('iara-dead-letter',jsonb_build_object('jobId',v_job.id,'tenantId',v_job.tenant_id,'type',v_job.queue_type,'payload',v_job.payload,'attemptsMade',v_job.attempts_made,'errorCode',left(p_error_code,200),'errorMessage',left(p_error_message,1000),'quarantinedAt',now())) INTO v_dlq_message_id;
  UPDATE public.iara_queue_jobs SET status='DEAD_LETTER',last_error_code=left(p_error_code,200),last_error_message=left(p_error_message,1000),updated_at=now() WHERE id=v_job.id;
  SELECT pgmq.archive(p_queue_name,p_message_id) INTO v_archived;
  RETURN COALESCE(v_archived,false) AND v_dlq_message_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.iara_enqueue_job(UUID,UUID,UUID,TEXT,JSONB,INTEGER,TEXT) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.iara_claim_queue_jobs(TEXT,INTEGER,INTEGER) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.iara_complete_queue_job(TEXT,BIGINT,UUID) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.iara_retry_queue_job(TEXT,BIGINT,UUID,INTEGER,INTEGER,TEXT,TEXT) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.iara_dead_letter_queue_job(TEXT,BIGINT,UUID,TEXT,TEXT) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.iara_enqueue_job(UUID,UUID,UUID,TEXT,JSONB,INTEGER,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.iara_claim_queue_jobs(TEXT,INTEGER,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.iara_complete_queue_job(TEXT,BIGINT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.iara_retry_queue_job(TEXT,BIGINT,UUID,INTEGER,INTEGER,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.iara_dead_letter_queue_job(TEXT,BIGINT,UUID,TEXT,TEXT) TO service_role;

COMMIT;
