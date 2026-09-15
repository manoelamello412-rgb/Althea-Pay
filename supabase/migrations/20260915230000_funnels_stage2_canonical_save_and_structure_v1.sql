begin;

drop function if exists public.save_funnel_domain_connection(text,text,text,text,text,boolean,timestamptz);
drop function if exists public.save_funnel_domain_connection(text,text,text,text,text,boolean);

drop function if exists public.seed_funnel_structure(text);
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
  insert into public.funnel_step_links (funnel_id,user_id,from_step_id,to_step_id,priority)
    select target_funnel,owner_id,a.id,b.id,0 from public.funnel_steps a join public.funnel_steps b on b.funnel_id=target_funnel and b.position=a.position+1 where a.funnel_id=target_funnel
  on conflict (from_step_id,to_step_id,priority) do nothing;
  return query select * from public.funnel_steps where funnel_id=target_funnel order by position;
end; $$;
revoke all on function public.seed_funnel_structure(text) from public, anon;
grant execute on function public.seed_funnel_structure(text) to authenticated;

create or replace function public.save_funnel_domain_connection(p_funnel_id text,p_name text,p_url text,p_external_funnel_id text,p_pixel_id text,p_chat_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public, private, pg_catalog as $$
declare v_user_id uuid:=auth.uid(); v_funnel public.funnels%rowtype; v_config jsonb; v_now timestamptz:=now();
begin
  if v_user_id is null then raise exception using errcode='42501',message='unauthorized'; end if;
  if nullif(trim(p_funnel_id),'') is null then raise exception using errcode='22023',message='funnel_id_required'; end if;
  if nullif(trim(p_name),'') is null then raise exception using errcode='22023',message='funnel_name_required'; end if;
  select * into v_funnel from public.funnels where id=trim(p_funnel_id) and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='funnel_not_found'; end if;
  if not private.is_org_member(v_funnel.organization_id) or not private.has_org_role(v_funnel.organization_id,array['owner','admin','manager','operator']) then raise exception using errcode='42501',message='forbidden'; end if;
  v_config:=jsonb_build_object('protocol_version','2026-09','external_funnel_id',nullif(trim(coalesce(p_external_funnel_id,'')),''),'pixel_id',nullif(trim(coalesce(p_pixel_id,'')),''),'chat_enabled',coalesce(p_chat_enabled,true),'updated_at',v_now);
  update public.funnels set nome=trim(p_name),url=nullif(trim(coalesce(p_url,'')),''),status='active',last_communication=coalesce(last_communication,v_now) where id=v_funnel.id;
  update public.funnel_connections set config=coalesce(config,'{}'::jsonb)||v_config,status='active',health_status=coalesce(health_status,'unknown'),updated_at=v_now where funnel_id=v_funnel.id and organization_id=v_funnel.organization_id;
  if not found then insert into public.funnel_connections(user_id,funnel_id,organization_id,connection_type,status,config,health_status,connected_at,updated_at) values(v_user_id,v_funnel.id,v_funnel.organization_id,'script','active',v_config,'unknown',v_now,v_now); end if;
  return jsonb_build_object('funnel_id',v_funnel.id,'organization_id',v_funnel.organization_id,'updated_at',v_now,'config',v_config);
end; $$;
revoke all on function public.save_funnel_domain_connection(text,text,text,text,text,boolean) from public, anon;
grant execute on function public.save_funnel_domain_connection(text,text,text,text,text,boolean) to authenticated;

alter table public.funnel_step_links add column if not exists organization_id uuid;
update public.funnel_step_links l set organization_id=f.organization_id from public.funnels f where f.id=l.funnel_id and l.organization_id is null;
alter table public.funnel_step_links alter column organization_id set not null;
create index if not exists funnel_step_links_org_funnel_idx on public.funnel_step_links(organization_id,funnel_id);
drop policy if exists funnel_step_links_owner_select on public.funnel_step_links;
drop policy if exists funnel_step_links_owner_insert on public.funnel_step_links;
drop policy if exists funnel_step_links_owner_update on public.funnel_step_links;
drop policy if exists funnel_step_links_owner_delete on public.funnel_step_links;
create policy funnel_step_links_tenant_select on public.funnel_step_links for select to authenticated using (private.is_org_member(organization_id));
create policy funnel_step_links_tenant_insert on public.funnel_step_links for insert to authenticated with check (private.has_org_role(organization_id,array['owner','admin','manager','operator']) and exists(select 1 from public.funnels f where f.id=funnel_step_links.funnel_id and f.organization_id=funnel_step_links.organization_id));
create policy funnel_step_links_tenant_update on public.funnel_step_links for update to authenticated using (private.has_org_role(organization_id,array['owner','admin','manager','operator'])) with check (private.has_org_role(organization_id,array['owner','admin','manager','operator']) and exists(select 1 from public.funnels f where f.id=funnel_step_links.funnel_id and f.organization_id=funnel_step_links.organization_id));
create policy funnel_step_links_tenant_delete on public.funnel_step_links for delete to authenticated using (private.has_org_role(organization_id,array['owner','admin']));
commit;
