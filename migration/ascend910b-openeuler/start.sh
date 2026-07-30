#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
test -f .env || { echo "missing .env" >&2; exit 1; }
docker-compose --env-file .env -f compose.yml up -d
