#!/usr/bin/env bash
set -euo pipefail

cd /mnt/e/projects/det-dashboard 2>/dev/null || cd /e/projects/det-dashboard 2>/dev/null || cd "$(dirname "$0")"

echo "[1/5] Stopping existing Node service on port 4177..."
if command -v lsof >/dev/null 2>&1; then
  pids="$(lsof -ti tcp:4177 || true)"
  if [ -n "${pids}" ]; then
    kill -9 ${pids} || true
  fi
fi
pkill -f "server/postgres-app.js" 2>/dev/null || true

echo "[2/5] Starting Docker service if available..."
if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl start docker 2>/dev/null || true
fi

echo "[3/5] Starting PostgreSQL and MinIO containers..."
docker start det-dashboard-postgres det-dashboard-minio

echo "[4/5] Setting runtime environment..."
export PORT="4177"
export DATA_ROOT="F:\\ZBH"
export STORAGE_ROOT="F:\\ZBH\\zhuji"
export DATABASE_URL="postgres://det:det_password@localhost:5432/det_dashboard"
export MINIO_ENDPOINT="localhost"
export MINIO_PORT="9000"
export MINIO_USE_SSL="false"
export MINIO_ACCESS_KEY="minioadmin"
export MINIO_SECRET_KEY="minioadmin"
export MINIO_BUCKET="zbh-datasets"

echo "[5/5] Starting det-dashboard at http://127.0.0.1:4177/"
echo "Logs are printed in this terminal."
npm run api:pg
