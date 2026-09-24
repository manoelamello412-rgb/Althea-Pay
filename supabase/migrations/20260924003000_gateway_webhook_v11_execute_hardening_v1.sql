-- G1-C: close direct service_role execution of the legacy gateway webhook processor.
-- The fenced SECURITY DEFINER wrapper remains the only authorized service_role boundary.

do $g1c_pre_guard$
declare
  v_v11 oid:=to_regprocedure(
    'public.process_gateway_webhook_v11(uuid,text,text,text,text,numeric,text,text)'
  )::oid;
  v_wrapper oid:=to_regprocedure(
    'public.server_process_claimed_gateway_webhook_v1(uuid,integer,text,text,text,text,numeric,text,text)'
  )::oid;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
  v_public_execute boolean;
  v_wrapper_definition text;
begin
  if v_v11 is null then
    raise exception 'g1c_pre_guard: process_gateway_webhook_v11 signature missing';
  end if;

  if v_wrapper is null then
    raise exception 'g1c_pre_guard: server_process_claimed_gateway_webhook_v1 signature missing';
  end if;

  select pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig
    into v_owner,v_security_definer,v_config
  from pg_proc p
  where p.oid=v_v11;

  if v_owner<>'postgres' or not v_security_definer then
    raise exception 'g1c_pre_guard: process_gateway_webhook_v11 owner/security mismatch';
  end if;

  if not (coalesce(v_config,ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public']) then
    raise exception 'g1c_pre_guard: process_gateway_webhook_v11 search_path mismatch';
  end if;

  select exists(
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid=v_v11
      and a.grantee=0
      and a.privilege_type='EXECUTE'
  ) into v_public_execute;

  if v_public_execute
     or has_function_privilege('anon',v_v11,'EXECUTE')
     or has_function_privilege('authenticated',v_v11,'EXECUTE') then
    raise exception 'g1c_pre_guard: unexpected non-server v11 execute privilege';
  end if;

  if not has_function_privilege('service_role',v_v11,'EXECUTE') then
    raise exception 'g1c_pre_guard: expected transitional service_role v11 execute missing';
  end if;

  select pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig
    into v_owner,v_security_definer,v_config
  from pg_proc p
  where p.oid=v_wrapper;

  if v_owner<>'postgres' or not v_security_definer then
    raise exception 'g1c_pre_guard: wrapper owner/security mismatch';
  end if;

  if not (coalesce(v_config,ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public']) then
    raise exception 'g1c_pre_guard: wrapper search_path mismatch';
  end if;

  if not has_function_privilege('service_role',v_wrapper,'EXECUTE') then
    raise exception 'g1c_pre_guard: wrapper service_role execute missing';
  end if;

  v_wrapper_definition:=regexp_replace(
    lower(pg_get_functiondef(v_wrapper)),
    E'\\s+',
    ' ',
    'g'
  );

  if position('select public.process_gateway_webhook_v11(' in v_wrapper_definition)=0 then
    raise exception 'g1c_pre_guard: wrapper no longer delegates to process_gateway_webhook_v11';
  end if;
end
$g1c_pre_guard$;

revoke execute
on function public.process_gateway_webhook_v11(
  uuid,
  text,
  text,
  text,
  text,
  numeric,
  text,
  text
)
from service_role;

do $g1c_post_guard$
declare
  v_v11 oid:=to_regprocedure(
    'public.process_gateway_webhook_v11(uuid,text,text,text,text,numeric,text,text)'
  )::oid;
  v_wrapper oid:=to_regprocedure(
    'public.server_process_claimed_gateway_webhook_v1(uuid,integer,text,text,text,text,numeric,text,text)'
  )::oid;
  v_public_execute boolean;
  v_wrapper_definition text;
begin
  if v_v11 is null or v_wrapper is null then
    raise exception 'g1c_post_guard: required gateway webhook function missing';
  end if;

  if has_function_privilege('service_role',v_v11,'EXECUTE') then
    raise exception 'g1c_post_guard: service_role direct v11 execute remains';
  end if;

  if has_function_privilege('anon',v_v11,'EXECUTE')
     or has_function_privilege('authenticated',v_v11,'EXECUTE') then
    raise exception 'g1c_post_guard: browser role v11 execute present';
  end if;

  select exists(
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid=v_v11
      and a.grantee=0
      and a.privilege_type='EXECUTE'
  ) into v_public_execute;

  if v_public_execute then
    raise exception 'g1c_post_guard: PUBLIC v11 execute present';
  end if;

  if not has_function_privilege('postgres',v_v11,'EXECUTE') then
    raise exception 'g1c_post_guard: postgres v11 execute missing';
  end if;

  if not has_function_privilege('service_role',v_wrapper,'EXECUTE') then
    raise exception 'g1c_post_guard: wrapper service_role execute missing';
  end if;

  v_wrapper_definition:=regexp_replace(
    lower(pg_get_functiondef(v_wrapper)),
    E'\\s+',
    ' ',
    'g'
  );

  if position('select public.process_gateway_webhook_v11(' in v_wrapper_definition)=0 then
    raise exception 'g1c_post_guard: wrapper delegation to v11 missing';
  end if;
end
$g1c_post_guard$;
