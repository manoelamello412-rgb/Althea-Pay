#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "================================================================="
echo "ALTHEA-PAY: INFRASTRUCTURE PRE-FLIGHT"
echo "================================================================="

command -v docker >/dev/null 2>&1 || { echo "Docker is required."; exit 1; }

echo "[1/4] TypeScript and ESLint"
npm run typecheck
npm run lint

echo "[2/4] Migration safety checks"
[ -d supabase/migrations ] || { echo "Missing supabase/migrations"; exit 1; }
if grep -RniE --include='*.sql' 'DROP[[:space:]]+DATABASE' supabase/migrations; then
  echo "Forbidden DROP DATABASE detected in migration set."
  exit 1
fi

if grep -RniE --include='*.sql' 'TRUNCATE[[:space:]]+public\.gateway_transactions|DROP[[:space:]]+TABLE[[:space:]]+public\.gateway_transactions' supabase/migrations; then
  echo "Destructive operation against the canonical transaction table detected."
  exit 1
fi

echo "[3/4] Ephemeral Supabase migration replay"
if ! npx supabase@latest start >/dev/null; then
  echo "Supabase local stack failed to start."
  exit 1
fi
cleanup() {
  npx supabase@latest stop --no-backup >/dev/null 2>&1 || true
}
trap cleanup EXIT

npx supabase@latest db reset --local --yes
npx supabase@latest db lint --local

echo "[4/4] Security and contract tests"
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="local-ci-publishable-key"
export SUPABASE_SERVICE_ROLE_KEY="local-ci-service-role-key"
export GATEWAY_WEBHOOK_SECRET="ci-only-webhook-secret"
npm test -- --run

echo "================================================================="
echo "INFRASTRUCTURE PRE-FLIGHT PASSED"
echo "================================================================="
