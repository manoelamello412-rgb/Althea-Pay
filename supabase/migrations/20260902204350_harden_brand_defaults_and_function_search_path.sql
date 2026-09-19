alter table public.brand_identity_settings alter column logo_url set default '/althea-mark.png';
alter table public.brand_identity_settings alter column logo_light_url set default '/althea-mark.png';
alter table public.brand_identity_settings alter column logo_dark_url set default '/althea-mark.png';
alter table public.brand_identity_settings alter column favicon_url set default '/althea-mark.png';

create or replace function public.can_failover_payment(p_failure_class text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select p_failure_class in ('technical','timeout','unavailable');
$function$;