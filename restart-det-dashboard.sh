#!/usr/bin/env bash
set -euo pipefail

cd /mnt/e/projects/det-dashboard 2>/dev/null || cd /e/projects/det-dashboard 2>/dev/null || cd "$(dirname "$0")"

CONFIG_FILE="det-dashboard.env"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "Missing $CONFIG_FILE. Please create it from .env.example."
  exit 1
fi

while IFS='=' read -r key value; do
  case "$key" in
    ""|\#*) continue ;;
  esac
  export "${key}=${value}"
done < "$CONFIG_FILE"

echo "[1/5] Stopping existing Node service on port ${PORT}..."
if command -v lsof >/dev/null 2>&1; then
  pids="$(lsof -ti "tcp:${PORT}" || true)"
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
docker start "${POSTGRES_CONTAINER}" "${MINIO_CONTAINER}"

echo "Waiting for PostgreSQL to accept connections..."
for _ in $(seq 1 60); do
  if docker exec "${POSTGRES_CONTAINER}" pg_isready -U det -d det_dashboard >/dev/null 2>&1; then
    echo "PostgreSQL is ready."
    break
  fi
  sleep 2
done

if ! docker exec "${POSTGRES_CONTAINER}" pg_isready -U det -d det_dashboard >/dev/null 2>&1; then
  echo "PostgreSQL did not become ready in time."
  exit 1
fi

echo "[4/5] Runtime config loaded from ${CONFIG_FILE}..."
echo "PORT=${PORT}"
echo "DATA_ROOT=${DATA_ROOT}"
echo "STORAGE_ROOT=${STORAGE_ROOT}"
echo "POSTGRES_CONTAINER=${POSTGRES_CONTAINER}"
echo "MINIO_CONTAINER=${MINIO_CONTAINER}"

echo "[5/5] Starting det-dashboard at http://127.0.0.1:${PORT}/"
echo "Logs are printed in this terminal."
npm run api:pg
