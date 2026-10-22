-- Postgres regex repetition counts cap at 255, so '{1,512}' raised on every non-null template name.
alter table public.crm_message_templates drop constraint if exists crm_message_templates_whatsapp_template_name_check;
alter table public.crm_message_templates add constraint crm_message_templates_whatsapp_template_name_check
  check (whatsapp_template_name ~ '^[a-z0-9_]+$' and length(whatsapp_template_name) <= 512);
