create or replace function public.crm_experiment_promote_winner(p_experiment_id uuid,p_variant_id uuid,p_reason text default null) returns jsonb language plpgsql security invoker set search_path=public as $$
declare e public.crm_experiments%rowtype; v public.crm_experiment_variants%rowtype; report jsonb; eligible boolean;
begin
 select * into e from public.crm_experiments where id=p_experiment_id and user_id=auth.uid() for update;
 if not found then raise exception 'experiment_not_found'; end if;
 if e.status <> 'running' then raise exception 'experiment_not_active'; end if;
 select * into v from public.crm_experiment_variants where id=p_variant_id and experiment_id=p_experiment_id;
 if not found then raise exception 'variant_not_found'; end if;
 report:=public.crm_experiment_report(p_experiment_id);
 eligible:=coalesce((report->>'winner_eligible')::boolean,false) and exists(select 1 from jsonb_array_elements(coalesce(report->'variants','[]'::jsonb)) x where (x->>'id')::uuid=p_variant_id and coalesce((x->>'eligible_for_winner')::boolean,false));
 if not eligible then raise exception 'winner_not_eligible'; end if;
 update public.crm_experiments set status='completed',updated_at=now() where id=p_experiment_id and user_id=auth.uid() and status='running';
 insert into public.crm_experiment_promotions(experiment_id,variant_id,user_id,approved_by,status,metadata) values(p_experiment_id,p_variant_id,auth.uid(),auth.uid(),'approved',jsonb_build_object('reason',p_reason,'report',report));
 return jsonb_build_object('ok',true,'experiment_id',p_experiment_id,'variant_id',p_variant_id,'status','approved','report',report,'approved_at',now());
end; $$;
revoke all on function public.crm_experiment_promote_winner(uuid,uuid,text) from public,anon;
grant execute on function public.crm_experiment_promote_winner(uuid,uuid,text) to authenticated;
