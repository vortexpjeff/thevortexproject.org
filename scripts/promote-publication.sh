#!/usr/bin/env bash
set -euo pipefail
lock=${VORTEX_SITE_LOCK:-$HOME/.cache/vortex-site/git.lock}
mkdir -p "$(dirname "$lock")"
exec 9>"$lock"
flock -w "${VORTEX_SITE_LOCK_TIMEOUT:-600}" 9
repo=${VORTEX_SITE_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
cd "$repo"
VORTEX_SITE_LOCK_HELD=1 exec node scripts/promote-publication.mjs "$@"