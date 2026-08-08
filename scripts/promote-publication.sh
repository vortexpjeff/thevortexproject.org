#!/usr/bin/env bash
set -euo pipefail
lock=${VORTEX_SITE_LOCK:-$HOME/.cache/vortex-site/git.lock}
mkdir -p "$(dirname "$lock")"
exec 9>"$lock"
flock -w "${VORTEX_SITE_LOCK_TIMEOUT:-600}" 9
cd /home/jvortex/vortex-site
VORTEX_SITE_LOCK_HELD=1 exec node scripts/promote-publication.mjs "$@"