#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

check_docker
initialize_env
ensure_directories
timestamp="$(date +%Y%m%d-%H%M%S)"
work="$ROOT_DIR/backups/.backup-$timestamp"
output="$ROOT_DIR/backups/det-dashboard-backup-$timestamp.tar.gz"
mkdir -p "$work"

restart_services() {
  compose up --no-build -d --wait --wait-timeout 180 >/dev/null 2>&1 || true
}
trap restart_services EXIT

compose up --no-build -d --wait postgres minio
compose stop app >/dev/null 2>&1 || true
echo "Creating PostgreSQL logical dump..."
compose exec -T postgres pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB" >"$work/postgres.dump"

echo "Quiescing MinIO and archiving persistent files..."
compose stop minio >/dev/null
tar -czf "$work/files.tar.gz" -C "$ROOT_DIR" .env portable-data/minio portable-data/storage exports runtime-assets
printf 'created_at=%s\napp_image=%s\n' "$(date -Iseconds)" "$APP_IMAGE" >"$work/manifest.txt"
tar -czf "$output" -C "$work" postgres.dump files.tar.gz manifest.txt
sha256sum "$output" >"$output.sha256"
rm -rf "$work"
compose up --no-build -d --wait --wait-timeout 180
trap - EXIT
echo "Backup created: $output"
