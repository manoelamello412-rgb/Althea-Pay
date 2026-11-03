\set ON_ERROR_STOP 1
do $$
declare org uuid := gen_random_uuid(); uid uuid := gen_random_uuid(); r jsonb;
begin
  insert into public.organizations values (org); insert into auth.users values (uid);
  perform set_config('test.org', org::text, false); perform set_config('test.uid', uid::text, false);
  perform private.resolve_customer(org, uid, null, '5511999990000', null, null, '{}');
  assert public.crm_whatsapp_known_phones(array['+55 11 99999-0000', '5521888887777']) = array['5511999990000'], 'known phones';
  r := public.crm_whatsapp_import_contacts('Grupo VIP', '[{"phone":"5511999990000","name":"Ana"},{"phone":"5521888887777","name":"Bia"},{"phone":"5521888887777","name":"Bia"},{"phone":"12","name":"x"}]');
  assert (r->>'imported')::int = 2 and (r->>'new')::int = 1, 'import: ' || r::text;
  assert (select data->>'name' from public.clients c join public.customer_identities i on i.client_id = c.id where i.value = '5521888887777') = 'Bia', 'name saved';
  assert (select count(*) from public.crm_contact_list_members m join public.crm_contact_lists l on l.id = m.list_id where l.name = 'Grupo VIP') = 2, 'list members';
end $$;
select 'PHASE 5 CHECKS PASSED';
