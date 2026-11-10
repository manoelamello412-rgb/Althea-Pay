-- CRM: HTML premium de e-mail e vinculo opcional por regra.
-- Seguro para regras existentes; nao altera gateway, funil ou RPCs legadas.
ALTER TABLE public.crm_message_templates
  ADD COLUMN IF NOT EXISTS email_html text;

ALTER TABLE public.crm_remarketing_rules
  ADD COLUMN IF NOT EXISTS template_id uuid
  REFERENCES public.crm_message_templates(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.crm_email_html_template_save(
  p_id uuid,
  p_name text,
  p_subject text,
  p_body text,
  p_email_html text,
  p_variables text[] DEFAULT '{}',
  p_active boolean DEFAULT false,
  p_email_header_url text DEFAULT null,
  p_email_button_text text DEFAULT null,
  p_email_button_url text DEFAULT null,
  p_trigger_event text DEFAULT null
)
RETURNS public.crm_message_templates
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v public.crm_message_templates;
BEGIN
  PERFORM 1 FROM private.crm_config_context('can_manage_automations');

  IF length(coalesce(p_email_html, '')) > 120000 THEN
    RAISE EXCEPTION 'EMAIL_HTML_TOO_LARGE' USING errcode = '22023';
  END IF;
  -- Filtro defensivo de HTML ativo; usar apenas HTML de autores confiaveis.
  IF coalesce(p_email_html, '') ~* '<[[:space:]]*(script|iframe|object|embed|form|base)([[:space:]>])'
     OR coalesce(p_email_html, '') ~*
       '(javascript:|data:text/html)'
     OR coalesce(p_email_html, '') ~*
       '(^|[^[:alnum:]_-])on[a-z]+[[:space:]]*=' THEN
    RAISE EXCEPTION 'EMAIL_HTML_UNSAFE' USING errcode = '22023';
  END IF;

  SELECT * INTO v FROM public.crm_template_save(
    p_id => p_id,
    p_name => p_name,
    p_channel => 'email',
    p_body => p_body,
    p_variables => p_variables,
    p_subject => p_subject,
    p_trigger_event => p_trigger_event,
    p_active => p_active,
    p_email_header_url => p_email_header_url,
    p_email_button_text => p_email_button_text,
    p_email_button_url => p_email_button_url
  );

  UPDATE public.crm_message_templates
     SET email_html = nullif(btrim(p_email_html), '')
   WHERE id = v.id RETURNING * INTO v;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_email_html_template_save(
  uuid,text,text,text,text,text[],boolean,text,text,text,text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_html_template_save(
  uuid,text,text,text,text,text[],boolean,text,text,text,text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_remarketing_rule_save_html(
  p_id uuid,
  p_trigger_event text,
  p_channel text,
  p_channel_account_id uuid,
  p_delay_minutes integer,
  p_body text,
  p_email_subject text DEFAULT null,
  p_button_text text DEFAULT null,
  p_button_url text DEFAULT null,
  p_funnel_id text DEFAULT null,
  p_active boolean DEFAULT false,
  p_template_id uuid DEFAULT null
)
RETURNS public.crm_remarketing_rules
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  c record;
  v public.crm_remarketing_rules;
BEGIN
  SELECT * INTO c FROM private.crm_config_context('can_manage_automations');
  IF p_channel <> 'email' THEN
    RAISE EXCEPTION 'EMAIL_TEMPLATE_CHANNEL_INVALID' USING errcode = '22023';
  END IF;
  IF p_template_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.crm_message_templates t
    WHERE t.id = p_template_id AND t.organization_id = c.organization_id
      AND t.channel = 'email' AND t.active = true
  ) THEN
    RAISE EXCEPTION 'EMAIL_TEMPLATE_INVALID' USING errcode = '22023';
  END IF;

  -- Associar template na mesma transacao; preservar RPC original.
  SELECT * INTO v FROM public.crm_remarketing_rule_save(
    p_id => p_id,
    p_trigger_event => p_trigger_event,
    p_channel => p_channel,
    p_channel_account_id => p_channel_account_id,
    p_delay_minutes => p_delay_minutes,
    p_body => p_body,
    p_email_subject => p_email_subject,
    p_button_text => p_button_text,
    p_button_url => p_button_url,
    p_funnel_id => p_funnel_id,
    p_active => false
  );

  UPDATE public.crm_remarketing_rules
     SET template_id = p_template_id, active = coalesce(p_active, false), updated_at = now()
   WHERE id = v.id AND organization_id = c.organization_id
   RETURNING * INTO v;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_remarketing_rule_save_html(
  uuid,text,text,uuid,integer,text,text,text,text,text,boolean,uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_remarketing_rule_save_html(
  uuid,text,text,uuid,integer,text,text,text,text,text,boolean,uuid
) TO authenticated;

NOTIFY pgrst, 'reload schema';
