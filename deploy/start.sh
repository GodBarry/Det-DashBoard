#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

check_docker
initialize_env
ensure_directories
start_dialog_bridge
load_offline_images
check_gpu
compose config --quiet
compose up --no-build -d --wait --wait-timeout 180
if [[ "$NATIVE_DIALOG_MODE" == "bridge" ]]; then
  compose exec -T app node -e \
    "fetch(process.env.HOST_DIALOG_URL + '/health', {headers:{'x-dialog-token':process.env.HOST_DIALOG_TOKEN}}).then(r=>process.exit(r.status===404?0:1)).catch(()=>process.exit(1))" \
    || die "Native file dialog bridge is not reachable from the app container"
  echo "Native Ubuntu file picker bridge verified."
fi

echo
echo "Det-DashBoard is ready: http://localhost:${APP_PORT:-5173}"
echo "Host folders visible to the app: ${HOST_BROWSE_ROOT}"
echo "Persistent data: ${ROOT_DIR}/portable-data"
echo "Run ./status.sh for health and ./backup.sh for a consistent backup."
