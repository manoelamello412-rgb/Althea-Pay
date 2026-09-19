DO $$
declare r record; q text; w text;
begin
  for r in select schemaname, tablename, policyname, qual, with_check from pg_policies where schemaname='public' loop
    q := r.qual;
    w := r.with_check;
    if q is not null then
      q := replace(q, '( SELECT auth.uid() AS uid)', '__ALTHEA_AUTH_UID__');
      q := replace(q, 'auth.uid()', '(select auth.uid())');
      q := replace(q, '__ALTHEA_AUTH_UID__', '(select auth.uid())');
    end if;
    if w is not null then
      w := replace(w, '( SELECT auth.uid() AS uid)', '__ALTHEA_AUTH_UID__');
      w := replace(w, 'auth.uid()', '(select auth.uid())');
      w := replace(w, '__ALTHEA_AUTH_UID__', '(select auth.uid())');
    end if;
    if q is not distinct from r.qual and w is not distinct from r.with_check then
      continue;
    end if;
    execute format('alter policy %I on %I.%I%s%s', r.policyname, r.schemaname, r.tablename,
      case when q is not null then format(' using (%s)', q) else '' end,
      case when w is not null then format(' with check (%s)', w) else '' end);
  end loop;
end $$;

create index if not exists iara_funnel_runtime_specs_user_id_idx on public.iara_funnel_runtime_specs(user_id);
