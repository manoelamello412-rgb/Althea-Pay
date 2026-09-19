begin;
create or replace function public.seed_funnel_structure(target_funnel text)
returns setof public.funnel_steps language plpgsql security definer
set search_path = public, private, pg_catalog as $$
declare owner_id uuid; funnel_org_id uuid;
begin
  select f.user_id,f.organization_id into owner_id,funnel_org_id from public.funnels f where f.id=target_funnel and f.deleted_at is null;
  if owner_id is null or funnel_org_id is null then raise exception 'FUNNEL_NOT_FOUND'; end if;
  if not private.is_org_member(funnel_org_id) or not private.has_org_role(funnel_org_id,array['owner','admin','manager','operator']) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  insert into public.funnel_steps (funnel_id,user_id,organization_id,step_key,step_type,name,position,status) values
    (target_funnel,owner_id,funnel_org_id,'entry','entry','Entrada',0,'active'),
    (target_funnel,owner_id,funnel_org_id,'sales-page','sales_page','Página de vendas',1,'draft'),
    (target_funnel,owner_id,funnel_org_id,'checkout','checkout','Checkout',2,'draft'),
    (target_funnel,owner_id,funnel_org_id,'payment','payment','Pagamento',3,'draft'),
    (target_funnel,owner_id,funnel_org_id,'thank-you','thank_you','Obrigado',4,'draft')
  on conflict (funnel_id,step_key) do nothing;
  insert into public.funnel_step_links (funnel_id,user_id,organization_id,from_step_id,to_step_id,priority)
    select target_funnel,owner_id,funnel_org_id,a.id,b.id,0 from public.funnel_steps a join public.funnel_steps b on b.funnel_id=target_funnel and b.position=a.position+1 where a.funnel_id=target_funnel
  on conflict (from_step_id,to_step_id,priority) do nothing;
  return query select * from public.funnel_steps where funnel_id=target_funnel order by position;
end; $$;
revoke all on function public.seed_funnel_structure(text) from public, anon;
grant execute on function public.seed_funnel_structure(text) to authenticated;
commit;