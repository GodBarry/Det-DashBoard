#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
test -f .env || cp .env.example .env
podman compose --env-file .env -f compose.yml up -d
podman compose --env-file .env -f compose.yml ps
