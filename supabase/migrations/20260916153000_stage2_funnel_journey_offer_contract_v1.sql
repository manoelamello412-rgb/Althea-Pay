create or replace function public.assign_funnel_offer_step(p_offer_id uuid,p_step_id uuid)
returns public.funnel_offers
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare offer_row public.funnel_offers; step_row public.funnel_steps; updated_offer public.funnel_offers;
begin
 select * into offer_row from public.funnel_offers where id=p_offer_id;
 if offer_row.id is null then raise exception 'OFFER_NOT_FOUND'; end if;
 select * into step_row from public.funnel_steps where id=p_step_id;
 if step_row.id is null then raise exception 'STEP_NOT_FOUND'; end if;
 if offer_row.funnel_id <> step_row.funnel_id then raise exception 'FUNNEL_MISMATCH' using errcode='23514'; end if;
 if not private.is_org_member(offer_row.organization_id) or not private.has_org_role(offer_row.organization_id,array['owner','admin','manager','operator']) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 update public.funnel_offers set step_id=p_step_id,updated_at=now() where id=p_offer_id returning * into updated_offer;
 return updated_offer;
end; $$;

grant execute on function public.assign_funnel_offer_step(uuid,uuid) to authenticated;
