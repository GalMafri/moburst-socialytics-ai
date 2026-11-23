#!/usr/bin/env bash
# Fails when this repo's shared cores differ from the peer repo's copies on main.
# Each repo's own checksum test can only compare a copy with itself; this is the
# check that sees a fork between the two repos.
#
# Needs PEER_REPO (owner/name) and PEER_TOKEN (a GitHub token that can read it).
# Without a token it says so and exits 0, so local runs and forks don't fail.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PEER_REPO="${PEER_REPO:?owner/name of the peer repo}"
PEER_REF="${PEER_REF:-main}"
if [ -z "${PEER_TOKEN:-}" ]; then
  echo "check-core-peer: PEER_TOKEN not set, skipping the cross-repo check" >&2
  exit 0
fi

status=0
for CORE in supabase/functions/_shared/api supabase/functions/_shared/cost; do
  [ -f "$ROOT/$CORE/CORE.sha256" ] || continue
  mine="$(tr -d '[:space:]' < "$ROOT/$CORE/CORE.sha256")"
  code="$(curl -sS -o /tmp/peer-core -w '%{http_code}' \
    -H "Authorization: Bearer $PEER_TOKEN" -H "Accept: application/vnd.github.raw" \
    -H "User-Agent: moburst-core-check/1.0" \
    "https://api.github.com/repos/$PEER_REPO/contents/$CORE/CORE.sha256?ref=$PEER_REF")"
  if [ "$code" = "404" ]; then
    echo "$CORE: not in $PEER_REPO@$PEER_REF yet" >&2
    continue
  fi
  [ "$code" = "200" ] || { echo "$CORE: GitHub answered $code" >&2; exit 1; }
  peer="$(tr -d '[:space:]' < /tmp/peer-core)"
  if [ "$mine" = "$peer" ]; then
    echo "$CORE: same as $PEER_REPO@$PEER_REF ($mine)"
  else
    echo "$CORE: DIFFERS from $PEER_REPO@$PEER_REF (here $mine, there $peer)." >&2
    echo "Core changes are made in AdVisor and copied with scripts/sync-api-core.sh. See CLAUDE.md." >&2
    status=1
  fi
done
exit $status
