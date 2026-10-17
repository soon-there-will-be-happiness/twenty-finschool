#!/usr/bin/env bash
# Fetch latest from twentyhq/twenty and merge into finschool/main.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"

REF="${1:-v2.9.0}"

git remote get-url upstream >/dev/null
git fetch upstream --tags --depth 1 "refs/tags/${REF}:refs/tags/${REF}" 2>/dev/null \
  || git fetch upstream --tags

git checkout finschool/main
git merge -m "merge upstream ${REF}" "tags/${REF}" || {
  echo "Merge conflicts — resolve under packages/, keep finschool/ intact."
  exit 1
}

echo "Merged upstream ${REF} into finschool/main"
