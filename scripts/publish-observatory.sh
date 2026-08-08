#!/usr/bin/env bash
set -euo pipefail
repo=${VORTEX_SITE_REPO:-/home/jvortex/vortex-site}
lock=${VORTEX_SITE_LOCK:-$HOME/.cache/vortex-site/git.lock}
mkdir -p "$(dirname "$lock")"
exec 9>"$lock"
flock -w "${VORTEX_SITE_LOCK_TIMEOUT:-600}" 9
cd "$repo"
if [[ -n "$(git diff --cached --name-only)" ]]; then
  echo "refusing Observatory publication: Git index is not empty" >&2
  git diff --cached --name-only >&2
  exit 70
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "refusing Observatory publication: tracked working tree is not clean" >&2
  git status --short --untracked-files=no >&2
  exit 71
fi
git pull --ff-only origin main
python3 scripts/generate_observatory_json.py
git add -- data/observatory.json
staged=$(git diff --cached --name-only)
if [[ -z "$staged" ]]; then
  echo "Observatory payload unchanged"
  exit 0
fi
if [[ "$staged" != "data/observatory.json" ]]; then
  echo "refusing Observatory publication: unexpected staged paths" >&2
  printf '%s\n' "$staged" >&2
  exit 72
fi
git commit -m "Vortex Observatory"
git push origin main
