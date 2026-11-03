-- clients_page_v1 era security invoker e chama private.current_organization_id().
-- authenticated não tem usage no schema private, então a chamada dava 403.
-- Passa a security definer; o escopo continua no filtro explícito por organização.
alter function public.clients_page_v1(text, timestamptz, timestamptz, integer) security definer;
