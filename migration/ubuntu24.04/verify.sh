#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
podman exec det-dashboard-postgres pg_isready -U "${POSTGRES_USER:-det}" -d "${POSTGRES_DB:-det_dashboard}"
curl --fail --silent --show-error "http://127.0.0.1:${MINIO_PORT:-9000}/minio/health/live" >/dev/null
echo 'PostgreSQL and MinIO are ready.'
