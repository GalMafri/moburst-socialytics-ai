#!/usr/bin/env bash
# Exercise deployment publication against an isolated fake server checkout.
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
cp "$repo_root/deploy.sh" "$fixture/deploy.sh"
mkdir -p "$fixture/bin" "$fixture/dist/assets"
printf 'old-index' > "$fixture/dist/index.html"
printf 'old-asset' > "$fixture/dist/assets/old.js"
cat > "$fixture/bin/npm" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = ci ]; then exit 0; fi
# The live page and assets must survive while a build is running.
test "$(cat dist/index.html)" = "${EXPECTED_INDEX:-old-index}"
test -f dist/assets/old.js
if [ "${FAIL_BUILD:-0}" = 1 ]; then exit 9; fi
mkdir -p "$5/assets"
printf 'new-index' > "$5/index.html"
printf 'new-asset' > "$5/assets/new.js"
printf '{"status":"ok"}' > "$5/health.json"
MOCK
printf '#!/usr/bin/env bash\nexit 0\n' > "$fixture/bin/git"
printf '#!/usr/bin/env bash\nexit 0\n' > "$fixture/bin/flock"
printf '#!/usr/bin/env bash\necho socialytics\n' > "$fixture/bin/forever"
printf '#!/usr/bin/env bash\nprintf '\''{"status":"ok"}'\''\n' > "$fixture/bin/curl"
chmod +x "$fixture/bin/"*
PATH="$fixture/bin:$PATH" bash "$fixture/deploy.sh" >/dev/null
test "$(cat "$fixture/dist/index.html")" = new-index
test -f "$fixture/dist/assets/new.js"
test -f "$fixture/dist/assets/old.js"
if FAIL_BUILD=1 EXPECTED_INDEX=new-index PATH="$fixture/bin:$PATH" bash "$fixture/deploy.sh" >/dev/null 2>&1; then
  echo 'Failed build incorrectly reported success' >&2
  exit 1
fi
test "$(cat "$fixture/dist/index.html")" = new-index
test -f "$fixture/dist/assets/new.js"
test -z "$(find "$fixture" -maxdepth 1 -name '.deploy-dist.*' -print)"
echo 'Deployment QA passed: live assets survive builds and failures; old chunks remain available.'
