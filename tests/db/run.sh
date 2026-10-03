#!/bin/bash
# Runs every tests/db/*.test.sql against a freshly built database. Each test
# file starts from the same fixture.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
PSQL=${PSQL:-"su postgres -c"}
status=0
for test in "$HERE"/*.test.sql; do
  "$HERE/apply_migrations.sh" >/dev/null
  $PSQL "psql -v ON_ERROR_STOP=1 -q -X" < "$HERE/fixture.sql" >/dev/null
  if out=$($PSQL "psql -v ON_ERROR_STOP=1 -q -X -t -A" < "$test" 2>&1); then
    echo "ok   $(basename "$test"): $(echo "$out" | tail -1)"
  else
    echo "FAIL $(basename "$test")"; echo "$out" | tail -15; status=1
  fi
done
exit $status
