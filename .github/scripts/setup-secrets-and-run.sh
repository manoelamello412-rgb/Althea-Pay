#!/usr/bin/env bash
set -euo pipefail

REPO="manoelamello412-rgb/Althea-Pay"
BRANCH="ci-security-hardening"

print_help() {
  cat <<EOF
Usage: ./setup-secrets-and-run.sh

This script will prompt for sensitive values and set them as GitHub Actions secrets
for the repository ${REPO}, then trigger the "Apply migrations & RLS" workflow on
branch ${BRANCH}.

Requirements:
- GitHub CLI (gh) installed and authenticated (gh auth login)
- You must have admin permission on the repository

The script does NOT print secrets to the terminal. Do NOT paste secrets into the
script or into this file. Provide them interactively when prompted.

EOF
}

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI not found. Install it: https://cli.github.com/"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: gh CLI not authenticated. Run: gh auth login"
  exit 1
fi

print_help

read -rp "Proceed to set secrets for repo ${REPO}? (y/N): " confirm
if [[ "${confirm,,}" != "y" ]]; then
  echo "Canceled by user."; exit 0
fi

# Prompt for secrets (silent)
read -s -p "DATABASE_URL (postgres://user:pass@host:5432/db): " DATABASE_URL; echo
read -s -p "ALTHEA_WEBHOOK_SECRET (HMAC secret): " ALTHEA_WEBHOOK_SECRET; echo
read -s -p "PSP_STRIPE_KEY (sk_test_...): " PSP_STRIPE_KEY; echo
read -s -p "PSP_STRIPE_WEBHOOK_SECRET (whsec_...) (press ENTER to skip): " PSP_STRIPE_WEBHOOK_SECRET; echo
read -s -p "SUPABASE_SERVICE_ROLE (press ENTER to skip): " SUPABASE_SERVICE_ROLE; echo

echo "Uploading secrets to GitHub (they will not be printed)..."

gh secret set DATABASE_URL --body "$DATABASE_URL" --repo "$REPO"
gh secret set ALTHEA_WEBHOOK_SECRET --body "$ALTHEA_WEBHOOK_SECRET" --repo "$REPO"
gh secret set PSP_STRIPE_KEY --body "$PSP_STRIPE_KEY" --repo "$REPO"

if [ -n "$PSP_STRIPE_WEBHOOK_SECRET" ]; then
  gh secret set PSP_STRIPE_WEBHOOK_SECRET --body "$PSP_STRIPE_WEBHOOK_SECRET" --repo "$REPO"
fi

if [ -n "$SUPABASE_SERVICE_ROLE" ]; then
  gh secret set SUPABASE_SERVICE_ROLE --body "$SUPABASE_SERVICE_ROLE" --repo "$REPO"
fi

echo "Secrets uploaded. Triggering workflows..."

# Try to trigger Apply migrations & RLS workflow by name; fall back to pushing an empty commit
if gh workflow run "Apply migrations & RLS" --repo "$REPO" --ref "$BRANCH" 2>/dev/null; then
  echo "Workflow dispatched: Apply migrations & RLS"
else
  echo "Failed to dispatch workflow by name (maybe name mismatch). Attempting fallback: pushing no-op commit to ${BRANCH}"
  git checkout "$BRANCH" || git fetch origin "$BRANCH" && git checkout -b "$BRANCH" origin/"$BRANCH"
  timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  git commit --allow-empty -m "ci: trigger workflows after secrets upload ($timestamp)"
  git push origin "$BRANCH"
  echo "Pushed no-op commit to ${BRANCH}. This should trigger the workflows configured on push."
fi

echo
echo "To follow runs in your terminal:"
echo "  gh run list --repo $REPO --limit 5"
echo "  gh run view <run-id> --repo $REPO --log"

echo
echo "If the Apply migrations run fails with a DB connection error, ensure the DATABASE_URL host accepts connections from GitHub Actions runners or use a bastion/VPN."

echo "Done. Monitor Actions at: https://github.com/$REPO/actions"
