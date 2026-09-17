#!/usr/bin/env bash
# Server-side deploy: pull latest, sync deps, build, restart under forever.
# Run by the GitHub Actions workflow over SSH. Idempotent.
set -euo pipefail

cd "$(dirname "$0")"

echo "==> git pull"
git fetch --all
git pull --ff-only origin main          # ship new commits (fails if history diverged)

echo "==> deps"
npm ci --no-audit --no-fund

echo "==> build"
npm run build

echo "==> restart forever"
# restart if already running under this uid, else start fresh.
# Capture the list first: piping `forever list` straight into `grep -q`
# makes grep close the pipe early, which crashes forever with EPIPE and,
# under `set -o pipefail`, would wrongly send us down the else branch.
running="$(forever list 2>/dev/null || true)"
if echo "$running" | grep -q "socialytics"; then
  forever restart socialytics
else
  forever start forever.json
fi

# `forever restart` signals the daemon and returns. It does not wait for the
# child to bind 3003, and `forever list` exits 0 whatever it prints, so until
# now this script's exit status only proved that a restart was REQUESTED. With
# max:10 and restartDelay:3000 in forever.json, a serve that dies on boot would
# flap for half a minute while the Actions run showed green.
#
# Ask the app itself, the way a visitor would.
echo "==> waiting for the app to answer"
probe_ok=0
for attempt in $(seq 1 20); do
  if curl -fsS --max-time 3 http://127.0.0.1:3003/health.json | grep -q '"status":"ok"'; then
    echo "    healthy after ${attempt} attempt(s)"
    probe_ok=1
    break
  fi
  sleep 2
done

if [ "$probe_ok" -ne 1 ]; then
  echo "!!! the app did not answer /health.json on port 3003 within ~40s"
  forever list || true
  tail -n 40 ./err.log 2>/dev/null || true
  exit 1
fi

echo "==> done"
forever list
