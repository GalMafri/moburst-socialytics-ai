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

echo "----"; echo "$pass passed, $fail failed"; [ "$fail" -eq 0 ]
