-- Public page snippet (althea.js): a browser on the funnel's own domain can
-- obtain a short-lived events:write client token with only the funnel id.
-- The binding is funnels.url (the "Link da Página" saved by the operator).

create or replace function private.funnel_origin_host(p_url text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select nullif(regexp_replace(lower(substring(trim(coalesce(p_url, '')) from '^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^/?#@]*@)?([^/?#:]+)')), '^www\.', ''), '')
$$;

revoke all on function private.funnel_origin_host(text) from public, anon, authenticated;

create or replace function public.resolve_funnel_public_origin(p_funnel_id text, p_origin text)
returns table(user_id uuid, funnel_id text)
language sql
stable
security definer
set search_path = public, private, pg_catalog
as $$
  select f.user_id, f.id
    from public.funnels f
   where f.id = trim(p_funnel_id)
     and f.deleted_at is null
     and private.funnel_origin_host(f.url) is not null
     and private.funnel_origin_host(f.url) = private.funnel_origin_host(p_origin)
   limit 1
$$;

revoke all on function public.resolve_funnel_public_origin(text, text) from public, anon, authenticated;
grant execute on function public.resolve_funnel_public_origin(text, text) to service_role;
