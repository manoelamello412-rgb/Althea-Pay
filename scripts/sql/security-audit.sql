-- Somente leitura. Rodar no SQL Editor do Supabase (produção) e colar o resultado.

-- A. RLS e policies das tabelas criadas fora das migrations.
select c.relname as tabela, c.relrowsecurity as rls_ligado,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
       has_table_privilege('anon', c.oid, 'select') as anon_select,
       has_table_privilege('authenticated', c.oid, 'update') as auth_update
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('clients','funnels','gateways','products','sales','merchant_business_profiles','outbound_webhooks');

-- B. Policies existentes dessas tabelas (para escrever as que faltam sem quebrar o app).
select tablename, policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename in ('clients','funnels','gateways','products','sales','merchant_business_profiles','outbound_webhooks')
 order by 1, 2;

-- C. Qualquer tabela public sem RLS.
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- D. Funções SECURITY DEFINER que anon ainda pode executar (deve listar só RPCs públicas de checkout/chat).
select p.oid::regprocedure
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
 order by 1;

-- E. Agenda real do cron.
select jobname, schedule, active from cron.job order by jobname;
