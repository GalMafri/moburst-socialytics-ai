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

echo "==> done"
forever list
