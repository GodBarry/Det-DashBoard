#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

check_docker
initialize_env
echo "Version: $(cat "$ROOT_DIR/VERSION" 2>/dev/null || echo development)"
echo "Docker: $(docker version --format '{{.Server.Version}}')"
echo "Compose: $(docker compose version --short)"
echo "Disk:"
df -h "$ROOT_DIR"
echo "Persistent directories:"
du -sh "$POSTGRES_DATA_DIR" "$MINIO_DATA_DIR" "$APP_STORAGE_DIR" "$EXPORTS_DIR" 2>/dev/null || true
echo "Compose configuration:"
compose config --quiet && echo OK
echo "Containers:"
compose ps
echo "Recent application logs:"
compose logs --tail 80 app
if [[ "${ENABLE_GPU:-false}" == "true" ]]; then
  echo "GPU:"
  nvidia-smi || true
fi
