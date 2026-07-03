#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"
if [[ -f images/offline-images.tar.gz && -f compose.yml ]]; then
  exec bash ./deploy/start.sh
fi
exec bash ./scripts/portable-start.sh
