#!/bin/bash
# End to end: the real screens in Chromium, the real Worker (in Vite's
# workerd), PostgREST and Postgres with every migration, and a local
# stand-in for Supabase sign-in (supabase-stub.mjs). Catches a screen
# sending something the API refuses, which the design preview cannot.
# Needs Postgres 16 running locally, as for tests/db/run.sh, and Chromium
# where Playwright looks for it (PLAYWRIGHT_BROWSERS_PATH).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PSQL=${PSQL:-"su postgres -c"}
WORK="$HERE/.work"
mkdir -p "$WORK"
PORT=${E2E_PORT:-5190}

"$ROOT/tests/db/apply_migrations.sh" >/dev/null
$PSQL "psql -v ON_ERROR_STOP=1 -q -X" < "$ROOT/tests/db/fixture.sql" >/dev/null
$PSQL "psql -v ON_ERROR_STOP=1 -q -X -d lltest" < "$HERE/seed.sql" >/dev/null

POSTGREST=${POSTGREST_BIN:-"$ROOT/tests/integration/.work/postgrest"}
if [ ! -x "$POSTGREST" ]; then
  curl -sSfL "https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz" | tar -xJ -C "$WORK"
  POSTGREST="$WORK/postgrest"
fi
SECRET="local-test-secret-local-test-secret-0123456789"
jwt() {
  node -e '
    const crypto = require("node:crypto");
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const body = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ role: process.argv[2], iss: "local" });
    console.log(body + "." + crypto.createHmac("sha256", process.argv[1]).update(body).digest("base64url"));
  ' "$SECRET" "$1"
}
cat > "$WORK/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:local-test-only@127.0.0.1:5432/lltest"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-port = 3006
db-max-rows = 1000
CONF

pids=()
cleanup() { for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT

"$POSTGREST" "$WORK/postgrest.conf" >"$WORK/postgrest.log" 2>&1 & pids+=($!)
node "$HERE/supabase-stub.mjs" 54322 3006 & pids+=($!)

cd "$ROOT"
CLOUDFLARE_INCLUDE_PROCESS_ENV=true \
NODE_ENV=development \
SUPABASE_URL=http://127.0.0.1:54322 \
SUPABASE_SECRET_KEY="$(jwt service_role)" \
ALLOWED_ORIGINS="http://127.0.0.1:$PORT" \
VITE_SUPABASE_URL=http://127.0.0.1:54322 \
VITE_SUPABASE_PUBLISHABLE_KEY="$(jwt anon)" \
  node_modules/.bin/vite --port "$PORT" --host 127.0.0.1 --strictPort >"$WORK/vite.log" 2>&1 & pids+=($!)

for _ in $(seq 1 120); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/" && break
  sleep 0.5
done

E2E_URL="http://127.0.0.1:$PORT" node --test --test-concurrency=1 "$HERE"/*.e2e.mjs
