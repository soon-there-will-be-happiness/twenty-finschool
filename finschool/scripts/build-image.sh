#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="${1:-local}"
UPSTREAM_TAG="${UPSTREAM_TAG:-latest}"

docker build \
  -f "$ROOT/docker/Dockerfile" \
  --build-arg "UPSTREAM_TAG=${UPSTREAM_TAG}" \
  -t "finschool/twenty:${TAG}" \
  "$ROOT"

echo "Built finschool/twenty:${TAG} (upstream tag ${UPSTREAM_TAG})"
