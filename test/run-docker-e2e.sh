#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TEST_ROOT="$(mktemp -d /tmp/det-dashboard-e2e.XXXXXX)"
PROJECT_NAME="det-dashboard-e2e-$$"
export COMPOSE_PROJECT_NAME="$PROJECT_NAME"
export APP_IMAGE="det-dashboard:e2e"
export APP_PORT="${TEST_APP_PORT:-15173}"
export DB_PORT="${TEST_DB_PORT:-55433}"
export MINIO_HOST_PORT="${TEST_MINIO_PORT:-59010}"
export MINIO_CONSOLE_HOST_PORT="${TEST_MINIO_CONSOLE_PORT:-59011}"
export DATASETS_DIR="$TEST_ROOT/datasets"
export DATA_ROOT_DISPLAY=/test-data
export HOST_BROWSE_ROOT="$TEST_ROOT/datasets"
export BROWSE_ROOT_DISPLAY=/test-data
export APP_STORAGE_DIR="$TEST_ROOT/storage"
export POSTGRES_DATA_DIR="$TEST_ROOT/postgres"
export MINIO_DATA_DIR="$TEST_ROOT/minio"
export EXPORTS_DIR="$TEST_ROOT/exports"
export EXPORT_ROOT_DISPLAY=/test-exports
export LOCAL_UID="$(id -u)"
export LOCAL_GID="$(id -g)"
export HOST_DIALOG_URL=""
export NATIVE_DIALOG_MODE=disabled
export OBJECT_STORE_WRITE_FALLBACK=false

compose=(docker compose --env-file /dev/null -f docker-compose.portable.yml)

cleanup() {
  "${compose[@]}" down -v >/dev/null 2>&1 || true
  docker run --rm -v "$TEST_ROOT:/target" postgres:16@sha256:fe03a7605299a34ddf5e4f285dff78c3d7190a576b3c6b46f2fcff69f4bffd54 sh -c 'rm -rf /target/* /target/.[!.]* /target/..?*' >/dev/null 2>&1 || true
  rmdir "$TEST_ROOT" >/dev/null 2>&1 || true
}
trap cleanup EXIT

node test/helpers/create-fixtures.js "$TEST_ROOT/datasets"
"${compose[@]}" up --build -d --wait

TEST_BASE_URL="http://127.0.0.1:$APP_PORT" \
TEST_DATA_DISPLAY=/test-data \
TEST_EXPORTS_DIR="$TEST_ROOT/exports" \
node test/integration/api-smoke.js

TEST_BASE_URL="http://127.0.0.1:$APP_PORT" \
PLAYWRIGHT_CHANNEL="${PLAYWRIGHT_CHANNEL:-chrome}" \
npm run test:e2e
