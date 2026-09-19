create table if not exists public.gateway_webhook_secrets (
  id uuid primary key default gen_random_uuid(),
  gateway_id text not null unique references public.gateways(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  secret_ref text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
alter table public.gateway_webhook_secrets enable row level security;
revoke all on table public.gateway_webhook_secrets from anon, authenticated;

create or replace function public.upsert_gateway_webhook_secret(p_gateway_id text,p_secret text)
returns jsonb language plpgsql security definer set search_path=public,vault,pg_catalog as $$
declare v_gateway_user uuid; v_ref text;
begin
 if auth.uid() is null or length(trim(coalesce(p_secret,'')))<16 then raise exception 'invalid_webhook_secret'; end if;
 select user_id into v_gateway_user from public.gateways where id=p_gateway_id and user_id=auth.uid();
 if v_gateway_user is null then raise exception 'gateway_not_found'; end if;
 select 'althea-gateway-webhook-'||p_gateway_id||'-'||gen_random_uuid() into v_ref;
 perform vault.create_secret(trim(p_secret),v_ref,'ALTHEA PAY gateway webhook secret');
 insert into public.gateway_webhook_secrets(gateway_id,user_id,secret_ref,is_active)
 values(p_gateway_id,auth.uid(),v_ref,true)
 on conflict(gateway_id) do update set secret_ref=excluded.secret_ref,is_active=true,updated_at=timezone('utc',now());
 return jsonb_build_object('gateway_id',p_gateway_id,'configured',true);
end;
$$;
revoke all on function public.upsert_gateway_webhook_secret(text,text) from public,anon;
grant execute on function public.upsert_gateway_webhook_secret(text,text) to authenticated;

create or replace function public.resolve_gateway_webhook_secret(p_gateway_id text)
returns text language plpgsql security definer set search_path=public,vault,pg_catalog as $$
declare v_ref text; v_secret text;
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'forbidden'; end if;
 select secret_ref into v_ref from public.gateway_webhook_secrets where gateway_id=p_gateway_id and is_active=true;
 if v_ref is null then raise exception 'webhook_secret_not_configured'; end if;
 select decrypted_secret into v_secret from vault.decrypted_secrets where name=v_ref limit 1;
 if v_secret is null then raise exception 'webhook_secret_unavailable'; end if;
 return v_secret;
end;
$$;
revoke all on function public.resolve_gateway_webhook_secret(text) from public,anon,authenticated;
grant execute on function public.resolve_gateway_webhook_secret(text) to service_role;
