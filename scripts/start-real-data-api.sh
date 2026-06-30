#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DATA_ROOT_DEFAULT="/home/barry/图片"
if [[ ! -d "$DATA_ROOT_DEFAULT" ]]; then
  DATA_ROOT_DEFAULT="$ROOT_DIR/runtime/data-root"
fi

export PATH="$ROOT_DIR/.conda-det-dashboard/bin:$PATH"
export PORT="${PORT:-4177}"
export DATA_ROOT="${DATA_ROOT:-$DATA_ROOT_DEFAULT}"
export STORAGE_ROOT="${STORAGE_ROOT:-$ROOT_DIR/runtime}"
export DATABASE_URL="${DATABASE_URL:-postgres://det:det_password@127.0.0.1:55432/det_dashboard}"
export MINIO_ENDPOINT="${MINIO_ENDPOINT:-127.0.0.1}"
export MINIO_PORT="${MINIO_PORT:-9000}"
export MINIO_USE_SSL="${MINIO_USE_SSL:-false}"
export MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
export MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin}"
export MINIO_BUCKET="${MINIO_BUCKET:-zbh-datasets}"
export MINIO_DATA_DIR="${MINIO_DATA_DIR:-$ROOT_DIR/runtime/minio}"
export OBJECT_STORE_WRITE_FALLBACK="${OBJECT_STORE_WRITE_FALLBACK:-true}"
export TRAINING_WORKER_ENABLED="${TRAINING_WORKER_ENABLED:-false}"

exec npm run api:pg
