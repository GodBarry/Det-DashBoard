#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

archive="${1:-}"
[[ -n "$archive" && -f "$archive" ]] || die "Usage: ./restore.sh backups/det-dashboard-backup-*.tar.gz"
check_docker
initialize_env
work="$(mktemp -d /tmp/det-dashboard-restore.XXXXXX)"
safety="$ROOT_DIR/backups/pre-restore-$(date +%Y%m%d-%H%M%S)"
trap 'rm -rf "$work"' EXIT
tar -xzf "$archive" -C "$work"
[[ -s "$work/postgres.dump" && -s "$work/files.tar.gz" ]] || die "Invalid backup archive"

echo "Stopping stack and preserving current files at: $safety"
compose down
mkdir -p "$safety"
for path in portable-data/minio portable-data/storage exports runtime-assets .env; do
  [[ -e "$ROOT_DIR/$path" ]] && mv "$ROOT_DIR/$path" "$safety/$(basename "$path")"
done
tar -xzf "$work/files.tar.gz" -C "$ROOT_DIR"
load_env
ensure_directories
compose up --no-build -d --wait postgres minio
echo "Restoring PostgreSQL..."
compose exec -T postgres pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB" <"$work/postgres.dump"
compose up --no-build -d --wait --wait-timeout 180
echo "Restore completed. Previous files remain at: $safety"
