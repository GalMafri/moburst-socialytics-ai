#!/usr/bin/env bash
# Production smoke suite for Socialytics (release-readiness skill). Under one minute.
# Set SOCIALYTICS_API_TEST_KEY for the keyed API checks; never put a value in this file.
set -u
APP="https://moburst-socialytics-ai.lovable.app"
FN="https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1"
pass=0; fail=0
check() { # name, expected, actual
  if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "PASS  $1 ($3)"; else fail=$((fail+1)); echo "FAIL  $1 (expected $2, got $3)"; fi
}
code() { curl -s -o /dev/null -m 30 -w "%{http_code}" "$@"; }

# 1. The app answers and serves a bundle that carries the API access card
check "app loads" 200 "$(code "$APP/")"
BUNDLE=$(curl -s -m 30 "$APP/" | grep -o '/assets/index-[^"]*\.js' | head -1)
check "bundle referenced" yes "$([ -n "$BUNDLE" ] && echo yes || echo no)"
check "bundle carries the API access card" 1 "$(curl -s -m 30 "$APP$BUNDLE" | grep -c 'Keys let gOS and other Moburst tools' | sed 's/^[2-9].*/1/')"

# 2. Staff-gated functions refuse anonymous calls
check "run-report refuses no auth" 401 "$(code -X POST "$FN/run-report" -H 'Content-Type: application/json' -d '{"client_id":"00000000-0000-0000-0000-000000000000"}')"
check "delete-client refuses no auth" 401 "$(code -X POST "$FN/delete-client" -H 'Content-Type: application/json' -d '{"client_id":"00000000-0000-0000-0000-000000000000"}')"
check "sprout-analytics refuses no auth" 401 "$(code -X POST "$FN/sprout-analytics" -H 'Content-Type: application/json' -d '{"client_id":"x","start":"2026-09-01","end":"2026-09-30"}')"
check "requireStaff refuses a wrong server secret" 401 "$(code -X POST "$FN/run-report" -H 'Content-Type: application/json' -H 'x-socialytics-secret: not-the-secret' -H 'x-socialytics-user: 00000000-0000-4000-8000-000000000000' -d '{"client_id":"00000000-0000-0000-0000-000000000000"}')"

# 3. The public API: alive, documented, closed without a key, open with one
check "api health" 200 "$(code "$FN/api/v1/health")"
check "api openapi" 1 "$(curl -s -m 30 "$FN/api/v1/openapi.json" | grep -c '"openapi"' | sed 's/^[2-9].*/1/')"
check "api refuses no key" 401 "$(code "$FN/api/v1/clients")"
check "api refuses a bad key" 401 "$(code "$FN/api/v1/clients" -H 'Authorization: Bearer soc_not_a_real_key')"
check "api worker refuses without the cron secret" 401 "$(code -X POST "$FN/api/internal/worker" -H 'Content-Type: application/json' -d '{}')"
if [ -n "${SOCIALYTICS_API_TEST_KEY:-}" ]; then
  check "api lists clients with a key" 200 "$(code "$FN/api/v1/clients?limit=1" -H "Authorization: Bearer $SOCIALYTICS_API_TEST_KEY")"
  check "api answers status with a key" 200 "$(code "$FN/api/v1/status" -H "Authorization: Bearer $SOCIALYTICS_API_TEST_KEY")"
  check "api status reports no schema drift" 0 "$(curl -s -m 60 "$FN/api/v1/status" -H "Authorization: Bearer $SOCIALYTICS_API_TEST_KEY" | grep -o 'api_schema_drift' | wc -l | tr -d ' ')"
  check "api refuses a demo with a read key or an empty body" 1 "$(code -X POST "$FN/api/v1/demo-jobs" -H "Authorization: Bearer $SOCIALYTICS_API_TEST_KEY" -H 'Content-Type: application/json' -d '{}' | grep -cE '^(400|403)$')"
else
  echo "SKIP  api key checks (SOCIALYTICS_API_TEST_KEY not set)"
fi

# 4. The Claude connector (mcp): closed without a token, pointing at its metadata, which
#    names this endpoint and Supabase Auth's OAuth server; the consent page is served
#    with what staff can save, and deck files are not public.
MCP="$FN/mcp"
AUTH="https://rwouwxqggjjacbpbhqsn.supabase.co/.well-known/oauth-authorization-server/auth/v1"
field() { node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{let v;try{v=JSON.parse(s)}catch{}for(const k of process.argv[1].split("."))v=v==null?v:v[k];console.log(Array.isArray(v)?v.join(" "):v==null?"":v)})' "$1"; }
check "mcp refuses no token" 401 "$(code -X POST "$MCP" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"
check "mcp points at its metadata" yes "$(curl -s -D - -o /dev/null -m 30 -X POST "$MCP" -H 'Content-Type: application/json' -d '{}' | tr -d '\r' | grep -qi "^www-authenticate: Bearer resource_metadata=\"$MCP/oauth-protected-resource\"" && echo yes || echo no)"
META=$(curl -s -m 30 "$MCP/oauth-protected-resource")
DISCOVERY=$(curl -s -m 30 "$AUTH")
check "mcp metadata names the connector URL" "$MCP" "$(printf '%s' "$META" | field resource)"
check "mcp metadata names Supabase Auth's issuer" "$(printf '%s' "$DISCOVERY" | field issuer)" "$(printf '%s' "$META" | field authorization_servers.0)"
check "auth server allows dynamic registration" yes "$([ -n "$(printf '%s' "$DISCOVERY" | field registration_endpoint)" ] && echo yes || echo no)"
check "auth server takes PKCE S256" yes "$(printf '%s' "$DISCOVERY" | field code_challenge_methods_supported | grep -qw S256 && echo yes || echo no)"
check "consent page served on socialytics.moburst.ai" 200 "$(code https://socialytics.moburst.ai/oauth/consent)"
check "bundle carries the consent page" 1 "$(curl -s -m 30 "$APP$BUNDLE" | grep -c 'Connect Claude to Socialytics' | sed 's/^[2-9].*/1/')"
check "bundle carries the consent page's save wording" 1 "$(curl -s -m 30 "$APP$BUNDLE" | grep -c 'Staff can also save client notes, approved copy, strategy edits and finished decks' | sed 's/^[2-9].*/1/')"
# Deck files are private: no public URL serves the report-decks bucket.
check "report-decks bucket is not public" 1 "$(code "https://rwouwxqggjjacbpbhqsn.supabase.co/storage/v1/object/public/report-decks/x.pptx" | grep -cE '^(400|404)$')"

echo "----"; echo "$pass passed, $fail failed"; [ "$fail" -eq 0 ]
