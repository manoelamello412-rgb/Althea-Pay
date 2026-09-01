#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_PROJECT_ID:?SUPABASE_PROJECT_ID is required}"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "SUPABASE_ACCESS_TOKEN is required for an actual migration run."
  exit 2
fi

npx supabase --version
npx supabase link --project-ref "$SUPABASE_PROJECT_ID" --password "${SUPABASE_DB_PASSWORD:-}" 2>/dev/null || true
npx supabase db diff --linked --schema public
