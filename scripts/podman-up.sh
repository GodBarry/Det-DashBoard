#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p \
  "$PROJECT_ROOT/runtime/postgres" \
  "$PROJECT_ROOT/runtime/minio" \
  "$PROJECT_ROOT/runtime/storage" \
  "$PROJECT_ROOT/runtime/datasets"

podman rm -f det-dashboard-postgres >/dev/null 2>&1 || true
podman rm -f det-dashboard-minio >/dev/null 2>&1 || true

podman run -d \
  --name det-dashboard-postgres \
  -p 5432:5432 \
  -e POSTGRES_DB=det_dashboard \
  -e POSTGRES_USER=det \
  -e POSTGRES_PASSWORD=det_password \
  -v "$PROJECT_ROOT/runtime/postgres:/var/lib/postgresql/data:Z,U" \
  -v "$PROJECT_ROOT/db/schema.sql:/docker-entrypoint-initdb.d/001_schema.sql:ro,Z" \
  docker.io/library/postgres:16

podman run -d \
  --name det-dashboard-minio \
  -p 9000:9000 \
  -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  -v "$PROJECT_ROOT/runtime/minio:/data:Z,U" \
  docker.io/minio/minio:latest \
  server /data --console-address ":9001"

podman ps --filter "name=det-dashboard-"
