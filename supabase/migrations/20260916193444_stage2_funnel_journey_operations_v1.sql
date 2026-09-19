create or replace function public.add_funnel_step(p_funnel_id text,p_step_type text,p_name text,p_config jsonb default '{}'::jsonb)
returns public.funnel_steps
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare f record; previous_step public.funnel_steps; created_step public.funnel_steps; next_position integer; next_key text;
begin
 select id,user_id,organization_id into f from public.funnels where id=p_funnel_id and deleted_at is null;
 if f.id is null then raise exception 'FUNNEL_NOT_FOUND'; end if;
 if not private.is_org_member(f.organization_id) or not private.has_org_role(f.organization_id,array['owner','admin','manager','operator']) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_step_type not in ('entry','landing','capture','sales_page','offer','checkout','payment','order_bump','upsell','downsell','thank_you','custom') then raise exception 'INVALID_STEP_TYPE' using errcode='22023'; end if;
 if nullif(trim(p_name),'') is null then raise exception 'STEP_NAME_REQUIRED' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('funnel-journey:'||p_funnel_id,0));
 select coalesce(max(position),-1)+1 into next_position from public.funnel_steps where funnel_id=p_funnel_id;
 next_key := lower(regexp_replace(trim(p_name),'[^a-zA-Z0-9]+','-','g')) || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,8);
 insert into public.funnel_steps(funnel_id,user_id,organization_id,step_key,step_type,name,position,status,config)
 values(p_funnel_id,f.user_id,f.organization_id,next_key,p_step_type,trim(p_name),next_position,'draft',coalesce(p_config,'{}'::jsonb)) returning * into created_step;
 select * into previous_step from public.funnel_steps where funnel_id=p_funnel_id and position=next_position-1;
 if previous_step.id is not null then
   insert into public.funnel_step_links(funnel_id,user_id,organization_id,from_step_id,to_step_id,priority)
   values(p_funnel_id,f.user_id,f.organization_id,previous_step.id,created_step.id,0)
   on conflict (from_step_id,to_step_id,priority) do nothing;
 end if;
 return created_step;
end; $$;

create or replace function public.update_funnel_step(p_step_id uuid,p_name text default null,p_status text default null,p_config jsonb default null)
returns public.funnel_steps
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare current_step public.funnel_steps; updated_step public.funnel_steps;
begin
 select * into current_step from public.funnel_steps where id=p_step_id;
 if current_step.id is null then raise exception 'STEP_NOT_FOUND'; end if;
 if not private.is_org_member(current_step.organization_id) or not private.has_org_role(current_step.organization_id,array['owner','admin','manager','operator']) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_status is not null and p_status not in ('draft','active','paused','archived') then raise exception 'INVALID_STEP_STATUS' using errcode='22023'; end if;
 if p_name is not null and nullif(trim(p_name),'') is null then raise exception 'STEP_NAME_REQUIRED' using errcode='22023'; end if;
 update public.funnel_steps set name=coalesce(nullif(trim(p_name),''),name),status=coalesce(p_status,status),config=coalesce(p_config,config),updated_at=now() where id=p_step_id returning * into updated_step;
 return updated_step;
end; $$;

grant execute on function public.add_funnel_step(text,text,text,jsonb) to authenticated;
grant execute on function public.update_funnel_step(uuid,text,text,jsonb) to authenticated;