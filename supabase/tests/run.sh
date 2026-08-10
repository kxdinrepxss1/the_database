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

# Applying the schema is quiet on success -- it is pages of "already exists"
# notices -- but an error here is the entire story, and discarding stdout used
# to discard that too: a setup.sql that would not apply failed the run with no
# output at all, which is a worse thing to be handed than the error.
apply() {
  if ! run "$1" >/dev/null; then
    echo "$1 did not apply:"
    # Matched case-sensitively on psql's own prefix: "error_events" appears in
    # a dozen harmless notices and would bury the one line that matters.
    grep -E "(ERROR|FATAL):" "$output" | head -20 || tail -20 "$output"
    exit 1
  fi
}

apply supabase/tests/stub-supabase.sql
apply supabase/setup.sql
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
