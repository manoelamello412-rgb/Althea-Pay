CREATE OR REPLACE FUNCTION public.bind_gateway_transaction_gateway(p_transaction_id uuid,p_user_id uuid,p_gateway_id text,p_expected_version bigint)
RETURNS public.gateway_transactions
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public
AS $function$
DECLARE v public.gateway_transactions;
BEGIN
 IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
 SELECT * INTO v FROM public.gateway_transactions WHERE id=p_transaction_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'transaction_not_found'; END IF;
 IF p_expected_version IS NOT NULL AND v.version<>p_expected_version THEN RAISE EXCEPTION 'concurrency_stale_detected'; END IF;
 IF v.status NOT IN ('created','pending') THEN RAISE EXCEPTION 'gateway_binding_not_allowed_for_terminal_transaction'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.gateways g WHERE g.id=p_gateway_id AND g.user_id=p_user_id) THEN RAISE EXCEPTION 'gateway_not_found'; END IF;
 UPDATE public.gateway_transactions SET gateway_id=p_gateway_id,version=version+1,updated_at=now() WHERE id=v.id AND user_id=p_user_id AND version=v.version RETURNING * INTO v;
 IF NOT FOUND THEN RAISE EXCEPTION 'concurrency_update_failed'; END IF;
 RETURN v;
END;$function$;
REVOKE ALL ON FUNCTION public.bind_gateway_transaction_gateway(uuid,uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bind_gateway_transaction_gateway(uuid,uuid,text,bigint) TO service_role;