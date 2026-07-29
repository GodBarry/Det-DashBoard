#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
podman compose --env-file .env -f compose.yml down
