#!/usr/bin/env bash
set -euo pipefail
repo=/home/jvortex/vortex-site
lock=${VORTEX_SITE_LOCK:-$HOME/.cache/vortex-site/git.lock}
mkdir -p "$(dirname "$lock")"
exec 9>"$lock"
flock -w "${VORTEX_SITE_LOCK_TIMEOUT:-600}" 9
cd "$repo"
if [[ -n "$(git diff --cached --name-only)" ]]; then
  echo "refusing editorial publication: Git index is not empty" >&2
  git diff --cached --name-only >&2
  exit 70
fi
npm ci
npm test
npm run test:production
git add -- institute-src/_data/editorial.json institute-src/dispatches institute-src/institute
unexpected=$(git diff --cached --name-only | grep -Ev '^(institute-src/_data/editorial\.json|institute-src/dispatches/|institute-src/institute/)' || true)
if [[ -n "$unexpected" ]]; then echo "unexpected staged paths" >&2; printf '%s\n' "$unexpected" >&2; exit 71; fi
echo "validated and staged exact editorial sources; commit and push remain deliberate"
