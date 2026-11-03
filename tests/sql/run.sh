#!/bin/sh
# Valida as migrations da Fase 0/1/2 num Postgres descartável (precisa de Docker).
# Uso: sh tests/sql/run.sh   → termina com "ALL BEHAVIOR CHECKS PASSED".
set -e
cd "$(dirname "$0")/../.."
docker rm -f althea-sqltest >/dev/null 2>&1 || true
docker run -d --rm --name althea-sqltest -e POSTGRES_PASSWORD=x postgres:16 >/dev/null
trap 'docker rm -f althea-sqltest >/dev/null 2>&1' EXIT
until docker exec althea-sqltest pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 1
for f in tests/sql/stubs.sql \
  supabase/migrations/20261102120000_db_stability_security_v1.sql \
  supabase/migrations/20261102130000_crm_whatsapp_multi_number_v1.sql \
  supabase/migrations/20261102140000_crm_inbox_block_purge_autoreply_v1.sql \
  tests/sql/crm-phase1-behavior.sql \
  tests/sql/stubs-phase2.sql \
  supabase/migrations/20261102150000_checkout_remarketing_rules_v1.sql \
  tests/sql/checkout-phase2-behavior.sql; do
  docker exec -i althea-sqltest psql -U postgres -q -v ON_ERROR_STOP=1 < "$f"
done
