#!/usr/bin/env bash
set -euo pipefail
repo=${VORTEX_SITE_REPO:-/home/jvortex/vortex-site}
lock=${VORTEX_SITE_LOCK:-$HOME/.cache/vortex-site/git.lock}
mkdir -p "$(dirname "$lock")"
exec 9>"$lock"
flock -w "${VORTEX_SITE_LOCK_TIMEOUT:-600}" 9
cd "$repo"
if [[ -n "$(git diff --cached --name-only)" ]]; then
  printf '%s\n' 'refusing Observatory publication: Git index is not empty' >&2
  exit 70
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  printf '%s\n' 'refusing Observatory publication: tracked working tree is not clean' >&2
  exit 71
fi
git -c credential.helper=store pull --ff-only origin main
# The wrapper owns publication; generation must not commit independently.
OBSERVATORY_NO_PUSH=1 python3 scripts/generate_observatory_json.py
git add -- data/observatory.json
staged=$(git diff --cached --name-only)
if [[ -n "$staged" && "$staged" != "data/observatory.json" ]]; then
  printf '%s\n' 'refusing Observatory publication: unexpected staged paths' >&2
  exit 72
fi
if [[ -n "$staged" ]]; then
  git -c user.name='Vortex Observatory' -c user.email=observatory@thevortexproject.org commit -m "observatory data $(date -u +%Y-%m-%dT%H:%MZ)"
fi
# Also retry an earlier successful commit whose push failed.
git -c credential.helper=store push origin main
