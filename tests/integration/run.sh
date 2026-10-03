#!/bin/bash
# Runs every tests/integration/*.test.ts against the Worker's services, talking
# to PostgREST (the API Supabase serves) over a freshly built test database.
# Each suite starts from tests/db/fixture.sql. Needs Postgres 16 running
# locally (as for tests/db/run.sh); PostgREST 12 is fetched if absent.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PSQL=${PSQL:-"su postgres -c"}
WORK="$HERE/.work"
mkdir -p "$WORK"

POSTGREST_VERSION=v12.2.3
POSTGREST=${POSTGREST_BIN:-"$WORK/postgrest"}
if [ ! -x "$POSTGREST" ]; then
  curl -sSfL "https://github.com/PostgREST/postgrest/releases/download/$POSTGREST_VERSION/postgrest-$POSTGREST_VERSION-linux-static-x64.tar.xz" \
    | tar -xJ -C "$WORK"
  POSTGREST="$WORK/postgrest"
fi

# A local-only signing secret; the token it signs is the service role's.
SECRET="local-test-secret-local-test-secret-0123456789"
SERVICE_JWT=$(node -e '
  const crypto = require("node:crypto");
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ role: "service_role", iss: "local" });
  console.log(body + "." + crypto.createHmac("sha256", process.argv[1]).update(body).digest("base64url"));
' "$SECRET")

cat > "$WORK/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:local-test-only@127.0.0.1:5432/lltest"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-port = 3005
db-max-rows = 1000
CONF

pids=()
cleanup() { for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT

node "$HERE/proxy.mjs" 54321 3005 & pids+=($!)

# Pass suite names (e.g. `run.sh controls`) to run only those.
suites=()
if [ $# -gt 0 ]; then for name in "$@"; do suites+=("$HERE/$name.test.ts"); done
else suites=("$HERE"/*.test.ts); fi

status=0
for suite in "${suites[@]}"; do
  name=$(basename "$suite" .test.ts)
  "$ROOT/tests/db/apply_migrations.sh" >/dev/null
  $PSQL "psql -v ON_ERROR_STOP=1 -q -X" < "$ROOT/tests/db/fixture.sql" >/dev/null

  "$POSTGREST" "$WORK/postgrest.conf" >"$WORK/postgrest.log" 2>&1 & postgrest=$!
  for _ in $(seq 1 50); do
    curl -sf -o /dev/null http://127.0.0.1:3005/ -H "Authorization: Bearer $SERVICE_JWT" && break
    sleep 0.2
  done

  "$ROOT/node_modules/.bin/esbuild" "$suite" --bundle --platform=node --format=esm --log-level=warning \
    --outfile="$WORK/$name.mjs" \
    --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
  if ! SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SECRET_KEY="$SERVICE_JWT" \
      node --test --test-concurrency=1 --test-reporter=dot "$WORK/$name.mjs"; then
    echo "FAIL $name"; status=1
  else
    echo "ok   $name"
  fi
  kill "$postgrest" 2>/dev/null || true
  wait "$postgrest" 2>/dev/null || true
done
exit $status
