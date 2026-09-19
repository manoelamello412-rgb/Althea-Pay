CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
ALTER TABLE public.idempotency_keys ADD COLUMN IF NOT EXISTS request_digest text;
ALTER TABLE public.idempotency_keys ADD COLUMN IF NOT EXISTS response_digest text;
CREATE UNIQUE INDEX IF NOT EXISTS idempotency_keys_scope_unique ON public.idempotency_keys(user_id, scope, idempotency_key);

CREATE OR REPLACE FUNCTION public.reserve_idempotency_key(
  p_user_id uuid,
  p_scope text,
  p_idempotency_key text,
  p_request_digest text,
  p_ttl interval DEFAULT interval '24 hours'
)
RETURNS TABLE(acquired boolean, id uuid, status text, response_code integer, response_payload jsonb, resource_type text, resource_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v public.idempotency_keys%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR nullif(trim(p_scope),'') IS NULL OR nullif(trim(p_idempotency_key),'') IS NULL THEN
    RAISE EXCEPTION 'invalid_idempotency_arguments';
  END IF;
  SELECT * INTO v FROM public.idempotency_keys
  WHERE user_id=p_user_id AND scope=p_scope AND idempotency_key=p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v.expires_at <= now() THEN
      UPDATE public.idempotency_keys
      SET status='processing', request_digest=p_request_digest, response_code=NULL, response_payload=NULL,
          response_digest=NULL, resource_type=NULL, resource_id=NULL, expires_at=now()+p_ttl, updated_at=now()
      WHERE id=v.id;
      RETURN QUERY SELECT true, v.id, 'processing'::text, NULL::integer, NULL::jsonb, NULL::text, NULL::text;
      RETURN;
    END IF;
    IF v.request_digest IS NOT NULL AND p_request_digest IS NOT NULL AND v.request_digest <> p_request_digest THEN
      RAISE EXCEPTION 'idempotency_key_reused_with_different_request';
    END IF;
    RETURN QUERY SELECT false, v.id, v.status, v.response_code, v.response_payload, v.resource_type, v.resource_id;
    RETURN;
  END IF;
  BEGIN
    INSERT INTO public.idempotency_keys(user_id,scope,idempotency_key,status,request_digest,expires_at)
    VALUES(p_user_id,p_scope,p_idempotency_key,'processing',p_request_digest,now()+p_ttl)
    RETURNING * INTO v;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v FROM public.idempotency_keys
    WHERE user_id=p_user_id AND scope=p_scope AND idempotency_key=p_idempotency_key;
    IF v.request_digest IS NOT NULL AND p_request_digest IS NOT NULL AND v.request_digest <> p_request_digest THEN
      RAISE EXCEPTION 'idempotency_key_reused_with_different_request';
    END IF;
    RETURN QUERY SELECT false, v.id, v.status, v.response_code, v.response_payload, v.resource_type, v.resource_id;
    RETURN;
  END;
  RETURN QUERY SELECT true, v.id, v.status, v.response_code, v.response_payload, v.resource_type, v.resource_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_idempotency_key(
  p_id uuid,
  p_status text,
  p_response_code integer,
  p_response_payload jsonb,
  p_resource_type text DEFAULT NULL,
  p_resource_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  IF p_status NOT IN ('completed','failed') THEN RAISE EXCEPTION 'invalid_idempotency_status'; END IF;
  UPDATE public.idempotency_keys
  SET status=p_status,response_code=p_response_code,response_payload=p_response_payload,
      response_digest=encode(extensions.digest(convert_to(coalesce(p_response_payload,'null'::jsonb)::text,'UTF8'),'sha256'),'hex'),
      resource_type=p_resource_type,resource_id=p_resource_id,updated_at=now()
  WHERE id=p_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_idempotency_key(uuid,text,text,text,interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_idempotency_key(uuid,text,integer,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_idempotency_key(uuid,text,text,text,interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_idempotency_key(uuid,text,integer,jsonb,text,text) TO service_role;

CREATE INDEX IF NOT EXISTS idempotency_keys_processing_idx ON public.idempotency_keys(status,expires_at) WHERE status='processing';
CREATE INDEX IF NOT EXISTS integration_events_worker_due_idx ON public.integration_events(status,next_retry_at,created_at) WHERE status IN ('pending','retry');
