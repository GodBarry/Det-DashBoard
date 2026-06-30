#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found. Install Docker first:"
  echo "  bash scripts/install-docker-ubuntu.sh"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is not available."
  exit 1
fi

docker compose -f docker-compose.real-data.yml up -d
docker compose -f docker-compose.real-data.yml ps

echo
echo "PostgreSQL real-data URL:"
echo "  postgres://det:det_password@127.0.0.1:55432/det_dashboard"
echo
echo "MinIO:"
echo "  API:     http://127.0.0.1:9000"
echo "  Console: http://127.0.0.1:9001"
