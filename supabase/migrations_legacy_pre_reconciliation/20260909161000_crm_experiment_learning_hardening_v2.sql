create unique index if not exists crm_experiment_exposures_subject_uq on public.crm_experiment_exposures(experiment_id,subject_key);
create unique index if not exists crm_experiment_outcomes_subject_outcome_uq on public.crm_experiment_outcomes(experiment_id,subject_key,outcome);

create or replace function public.crm_experiment_record_outcome(p_exposure_id uuid,p_outcome text,p_value numeric default null)
returns uuid language plpgsql security invoker set search_path=public as $$
declare e record; oid uuid;
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
 select * into e from public.crm_experiment_exposures where id=p_exposure_id and user_id=auth.uid();
 if not found then raise exception 'EXPOSURE_NOT_FOUND'; end if;
 if nullif(trim(p_outcome),'') is null then raise exception 'INVALID_OUTCOME'; end if;
 insert into public.crm_experiment_outcomes(experiment_id,variant_id,user_id,subject_key,outcome,value)
 values(e.experiment_id,e.variant_id,e.user_id,e.subject_key,trim(p_outcome),p_value)
 on conflict (experiment_id,subject_key,outcome) do update set value=excluded.value, occurred_at=now()
 returning id into oid;
 return oid;
end; $$;

create or replace function public.crm_experiment_report(p_experiment_id uuid)
returns jsonb language sql stable security invoker set search_path=public as $$
with e as (select id from public.crm_experiments where id=p_experiment_id and user_id=auth.uid()),
variants as (
 select v.id,v.name,v.weight,count(distinct x.subject_key) exposures,
 count(distinct case when o.outcome='converted' then o.subject_key end) conversions,
 coalesce(sum(case when o.outcome='revenue' then o.value else 0 end),0) revenue
 from public.crm_experiment_variants v join e on e.id=v.experiment_id
 left join public.crm_experiment_exposures x on x.variant_id=v.id
 left join public.crm_experiment_outcomes o on o.variant_id=v.id and o.subject_key=x.subject_key
 group by v.id,v.name,v.weight
), totals as (select coalesce(sum(exposures),0) exposures,coalesce(sum(conversions),0) conversions,coalesce(sum(revenue),0) revenue from variants)
select jsonb_build_object('experiment_id',p_experiment_id,'variants',coalesce((select jsonb_agg(jsonb_build_object('variant_id',id,'name',name,'weight',weight,'exposures',exposures,'conversions',conversions,'conversion_rate',case when exposures>0 then round(conversions::numeric/exposures,6) else 0 end,'revenue',revenue) order by name) from variants),'[]'::jsonb),'totals',(select to_jsonb(totals) from totals),'generated_at',now());
$$;
revoke all on function public.crm_experiment_report(uuid) from public,anon;
grant execute on function public.crm_experiment_report(uuid) to authenticated;
