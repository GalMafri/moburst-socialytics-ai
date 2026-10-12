#!/usr/bin/env bash
# Server-side deploy: pull latest, sync deps, build, restart under forever.
# Run by the GitHub Actions workflow over SSH. Idempotent.
set -euo pipefail

cd "$(dirname "$0")"

# Concurrent SSH runs share this checkout and node_modules. Serialize the
# dependency install, build and publication without cancelling a live deploy.
exec 9>.deploy.lock
flock -x 9

echo "==> git pull"
git fetch --all
git pull --ff-only origin main          # ship new commits (fails if history diverged)

echo "==> deps"
npm ci --no-audit --no-fund

echo "==> build"
# Vite empties its output directory before building. Keep the currently served
# dist intact, publish new hashed assets first, and switch index.html last.
# Retain old hashed assets so tabs opened before this release still load them.
next_dist="$(mktemp -d .deploy-dist.XXXXXX)"
trap 'rm -rf -- "$next_dist"' EXIT
npm run build -- --outDir "$next_dist"
mkdir -p dist/assets
cp -a "$next_dist/assets/." dist/assets/
rsync -a --exclude=assets --exclude=index.html "$next_dist/" dist/
cp "$next_dist/index.html" dist/index.html.next
mv -f dist/index.html.next dist/index.html

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

echo "==> design worker"
# The design engine's worker (engine/scripts/worker.py) runs beside the app under forever when the box carries its
# environment file at engine/.env (ANTHROPIC_API_KEY, SOCIALYTICS_STORE_URL, SOCIALYTICS_PROBE_URL, SOCIALYTICS_ACT_AS_USER).
# Without that file nothing starts and the app is unaffected.
if [ -f engine/.env ]; then
  if ! command -v uv >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 || true
    export PATH="$HOME/.local/bin:$PATH"
  fi
  if command -v uv >/dev/null 2>&1; then
    (cd engine && uv sync --frozen >/dev/null 2>&1 || uv sync >/dev/null 2>&1) || echo "design worker: uv sync failed"
    (cd engine && uv run python -m playwright install chromium >/dev/null 2>&1) || echo "design worker: chromium install failed"
    (cd engine/video && npm ci --no-audit --no-fund >/dev/null 2>&1) || echo "design worker: video deps failed"
    worker_running="$(forever list 2>/dev/null || true)"
    if echo "$worker_running" | grep -q "design-worker"; then
      forever restart design-worker
    else
      (cd engine && forever start --uid design-worker -c "uv run python scripts/worker.py" .)
    fi
  else
    echo "design worker: uv unavailable, worker not started"
  fi
else
  echo "design worker: engine/.env absent on this host, worker not started"
fi
