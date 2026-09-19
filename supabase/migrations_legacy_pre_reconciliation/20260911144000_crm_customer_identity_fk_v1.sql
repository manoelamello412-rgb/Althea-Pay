-- Tenant-scoped canonical Customer -> Conversation relation.
CREATE UNIQUE INDEX IF NOT EXISTS clients_user_id_id_uq ON public.clients(user_id,id);
ALTER TABLE public.crm_conversations DROP CONSTRAINT IF EXISTS crm_conversations_customer_identity_fkey;
ALTER TABLE public.crm_conversations ADD CONSTRAINT crm_conversations_customer_identity_fkey FOREIGN KEY (user_id,customer_id) REFERENCES public.clients(user_id,id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.crm_conversations VALIDATE CONSTRAINT crm_conversations_customer_identity_fkey;
