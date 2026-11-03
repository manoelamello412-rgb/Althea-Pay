\set ON_ERROR_STOP 1
do $$
declare org uuid := gen_random_uuid(); uid uuid := gen_random_uuid();
begin
  insert into public.organizations values (org); insert into auth.users values (uid);
  perform set_config('test.org', org::text, false); perform set_config('test.uid', uid::text, false);
  insert into public.platform_settings values (uid, '{"iara":{"name":"Ana"},"recovery":{"senderEmail":"x@y.com"}}');
  assert (public.recovery_settings_v1()->>'cart_automation')::boolean = false, 'default off';
  perform public.recovery_settings_set_v1(true);
  assert (public.recovery_settings_v1()->>'cart_automation')::boolean, 'on';
  assert (select data#>>'{iara,name}' from public.platform_settings where user_id = uid) = 'Ana', 'other settings kept';
  assert (select data#>>'{recovery,senderEmail}' from public.platform_settings where user_id = uid) = 'x@y.com', 'recovery siblings kept';
end $$;
select 'PHASE 4 CHECKS PASSED';
