#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=${VORTEX_SITE_REPO:-$(cd "$script_dir/.." && pwd)}
lock=${VORTEX_SITE_LOCK:-$HOME/.cache/vortex-site/git.lock}
mkdir -p "$(dirname "$lock")"
exec 9>"$lock"
flock -w "${VORTEX_SITE_LOCK_TIMEOUT:-600}" 9
if git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
  if [[ -n "$(git -C "$repo" diff --cached --name-only)" ]]; then
    echo "refusing assessment recording: Git index is not empty" >&2
    exit 70
  fi
  if [[ -n "$(git -C "$repo" status --porcelain --untracked-files=no)" ]]; then
    echo "refusing assessment recording: tracked working tree is not clean" >&2
    exit 71
  fi
fi
VORTEX_SITE_LOCK_HELD=1 exec node "$script_dir/record-publication-assessment.mjs" "$@"
