CREATE OR REPLACE FUNCTION public.broadcast_operational_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  PERFORM realtime.broadcast_changes(
    'althea:' || coalesce(NEW.user_id, OLD.user_id)::text || ':operations',
    TG_OP,
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW END,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD END,
    'ROW'
  );
  RETURN coalesce(NEW, OLD);
END;
$function$;

REVOKE ALL ON FUNCTION public.broadcast_operational_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_operational_change() TO service_role;
