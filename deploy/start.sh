#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

check_docker
initialize_env
ensure_directories
load_offline_images
check_gpu
compose config --quiet
compose up --no-build -d --wait --wait-timeout 180

echo
echo "Det-DashBoard is ready: http://localhost:${APP_PORT:-5173}"
echo "Host folders visible to the app: ${HOST_BROWSE_ROOT}"
echo "Persistent data: ${ROOT_DIR}/portable-data"
echo "Run ./status.sh for health and ./backup.sh for a consistent backup."
