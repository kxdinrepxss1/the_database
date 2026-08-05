#!/usr/bin/env bash
# Runs every policy suite against a scratch PostgreSQL database.
#
# Point DATABASE_URL at a throwaway database, never a real project: these
# suites create users, plant deliberately broken policies, and delete rows.
#
#   DATABASE_URL=postgres://... supabase/tests/run.sh
#
# Exits non-zero if any check reports FAIL, or if any statement errors.
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL to a scratch database}"
cd "$(dirname "$0")/../.."

output=$(mktemp)
trap 'rm -f "$output"' EXIT

run() {
  echo "=== $1"
  # ON_ERROR_STOP turns a broken statement into a failed run rather than a
  # skipped check that still prints PASS for everything after it.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$1" 2>&1 | tee -a "$output"
}

run supabase/tests/stub-supabase.sql >/dev/null
run supabase/setup.sql >/dev/null
run supabase/tests/policies.test.sql
run supabase/tests/sharing.test.sql
run supabase/tests/rogue-policy.test.sql

if grep -q "FAIL" "$output"; then
  echo
  echo "Policy checks failed:"
  grep "FAIL" "$output"
  exit 1
fi

# A suite that silently ran nothing would otherwise look like a pass.
passes=$(grep -c "PASS" "$output" || true)
if [ "$passes" -lt 30 ]; then
  echo "Only $passes checks ran, expected at least 30 - did a suite stop early?"
  exit 1
fi

echo
echo "All $passes policy checks passed"
