#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="${1:-$(node -p "require('./package.json').version")-$(git rev-parse --short HEAD)}"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "Unsupported release architecture: $ARCH" >&2; exit 1 ;;
esac

OUTPUT_DIR="${RELEASE_OUTPUT_DIR:-$ROOT_DIR/release-dist}"
STAGE="$OUTPUT_DIR/det-dashboard-$VERSION-linux-$ARCH"
ARCHIVE="$OUTPUT_DIR/det-dashboard-$VERSION-linux-$ARCH.tar.gz"
APP_IMAGE="det-dashboard:$VERSION"
POSTGRES_UPSTREAM="postgres:16@sha256:fe03a7605299a34ddf5e4f285dff78c3d7190a576b3c6b46f2fcff69f4bffd54"
MINIO_UPSTREAM="minio/minio:RELEASE.2025-09-07T16-13-09Z@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e"
POSTGRES_IMAGE="det-dashboard-postgres:16"
MINIO_IMAGE="det-dashboard-minio:2025-09-07"

command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }
docker info >/dev/null
mkdir -p "$OUTPUT_DIR"
rm -rf "$STAGE" "$ARCHIVE" "$ARCHIVE.sha256"
mkdir -p "$STAGE/images" "$STAGE/db" "$STAGE/datasets" "$STAGE/exports" \
  "$STAGE/scripts" \
  "$STAGE/portable-data/storage" "$STAGE/portable-data/postgres" "$STAGE/portable-data/minio" \
  "$STAGE/runtime-assets/models" "$STAGE/runtime-assets/python-envs" "$STAGE/backups"

echo "Building application image $APP_IMAGE..."
docker build --build-arg "APP_VERSION=$VERSION" -t "$APP_IMAGE" .
echo "Fetching pinned infrastructure images..."
docker pull "$POSTGRES_UPSTREAM"
docker pull "$MINIO_UPSTREAM"
docker tag "$POSTGRES_UPSTREAM" "$POSTGRES_IMAGE"
docker tag "$MINIO_UPSTREAM" "$MINIO_IMAGE"

cp -a deploy/. "$STAGE/"
cp db/schema.sql "$STAGE/db/schema.sql"
cp scripts/folder-dialog-bridge.py "$STAGE/scripts/folder-dialog-bridge.py"
cp docs/release-architecture.md "$STAGE/ARCHITECTURE.md"
cp docs/code-audit-2026-07-03.md "$STAGE/CODE-AUDIT.md"
cp docs/architecture-optimization-proposals-2026-07-04.md "$STAGE/ARCHITECTURE-OPTIMIZATION.md"
cp .env.portable.example "$STAGE/SOURCE-CONFIG-REFERENCE.env"
cp deploy/env.example "$STAGE/env.example"
sed -i "s|^APP_IMAGE=.*|APP_IMAGE=$APP_IMAGE|" "$STAGE/env.example"
sed -i "s|^POSTGRES_IMAGE=.*|POSTGRES_IMAGE=$POSTGRES_IMAGE|" "$STAGE/env.example"
sed -i "s|^MINIO_IMAGE=.*|MINIO_IMAGE=$MINIO_IMAGE|" "$STAGE/env.example"
printf '%s\n' "$VERSION" >"$STAGE/VERSION"
printf '%s\n' "$(git rev-parse HEAD)" >"$STAGE/SOURCE_COMMIT"

echo "Exporting offline Docker images..."
docker image save "$APP_IMAGE" "$POSTGRES_IMAGE" "$MINIO_IMAGE" | gzip -1 >"$STAGE/images/offline-images.tar.gz"

chmod +x "$STAGE"/*.sh
(cd "$STAGE" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS)
tar -czf "$ARCHIVE" -C "$OUTPUT_DIR" "$(basename "$STAGE")"
sha256sum "$ARCHIVE" >"$ARCHIVE.sha256"

echo "Release archive: $ARCHIVE"
echo "Checksum:       $ARCHIVE.sha256"
