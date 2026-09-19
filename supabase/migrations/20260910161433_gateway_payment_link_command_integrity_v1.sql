create or replace function public.mark_gateway_payment_link_failed(p_link_id uuid,p_reason text)
returns boolean language plpgsql security definer set search_path=public,pg_catalog as $$ begin if coalesce(auth.role(),'') <> 'service_role' then raise exception 'forbidden'; end if; update public.gateway_payment_links set status='failed',metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{failure_reason}',to_jsonb(left(coalesce(p_reason,'unknown'),500)),true),updated_at=now() where id=p_link_id and status='pending'; return found; end $$;
revoke all on function public.mark_gateway_payment_link_failed(uuid,text) from public,anon,authenticated;
grant execute on function public.mark_gateway_payment_link_failed(uuid,text) to service_role;
