update public.gateway_provider_registry
set credential_schema = jsonb_set(
  credential_schema,
  '{fields}',
  (credential_schema->'fields') || jsonb_build_array(
    jsonb_build_object('key','custom_headers','label','Custom Headers JSON','type','text','required',false)
  )
), updated_at = now()
where provider_key = 'custom_rest';