#!/bin/bash
# Builds the lltest database from scratch: Supabase stand-ins, then every
# migration in order, stopping at the first failure. Run as a user that can
# `su postgres` (CI and the dev container), from the repository root.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PSQL=${PSQL:-"su postgres -c"}
run_sql() { $PSQL "psql -v ON_ERROR_STOP=1 -q -X $*"; }
run_sql "" < "$HERE/bootstrap.sql" >/dev/null
count=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  if ! { echo '\c lltest'; cat "$f"; } | run_sql "" >/dev/null 2>"$HERE/.migration.err"; then
    echo "FAILED: $f"; cat "$HERE/.migration.err"; exit 1
  fi
  count=$((count + 1))
done
rm -f "$HERE/.migration.err"
echo "applied $count migrations"
