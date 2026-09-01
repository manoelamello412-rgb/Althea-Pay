#!/usr/bin/env bash
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set"
  exit 1
fi

echo "Applying migrations..."
psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql

echo "Applying policies..."
psql "$DATABASE_URL" -f supabase/migrations/policies.sql

echo "Done."
