#!/usr/bin/env bash
set -euo pipefail

podman rm -f det-dashboard-postgres >/dev/null 2>&1 || true
podman rm -f det-dashboard-minio >/dev/null 2>&1 || true

echo "det-dashboard Podman services stopped."
