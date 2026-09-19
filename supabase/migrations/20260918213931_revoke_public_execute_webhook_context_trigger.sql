
-- link_gateway_webhook_event_context() é uma função de trigger (RETURNS trigger) usada apenas
-- internamente por gateway_webhook_events. Funções de trigger não podem ser chamadas via RPC direta
-- (Postgres rejeita: "trigger functions can only be called as triggers"), então isso não era
-- explorável de fato, mas o EXECUTE ficava concedido a PUBLIC/anon/authenticated por padrão,
-- gerando ruído no advisor de segurança. Revogado para deixar explícito que é uso interno.
-- Revogar EXECUTE não afeta o disparo do trigger (o executor invoca a função internamente,
-- sem checar privilégio de EXECUTE do papel da sessão).
revoke execute on function public.link_gateway_webhook_event_context() from public;
revoke execute on function public.link_gateway_webhook_event_context() from anon;
revoke execute on function public.link_gateway_webhook_event_context() from authenticated;
