#!/usr/bin/env bash
set -euo pipefail

archive="${1:-}"
[[ -n "$archive" && -f "$archive" ]] || { echo "Usage: $0 release-dist/det-dashboard-*.tar.gz" >&2; exit 1; }
work="$(mktemp -d /tmp/det-dashboard-release-check.XXXXXX)"
trap 'rm -rf "$work"' EXIT
tar -xzf "$archive" -C "$work"
bundle="$(find "$work" -mindepth 1 -maxdepth 1 -type d | head -1)"
[[ -n "$bundle" ]] || { echo "archive has no bundle directory" >&2; exit 1; }

required=(start.sh stop.sh status.sh backup.sh restore.sh diagnose.sh compose.yml compose.gpu.yml env.example VERSION SOURCE_COMMIT SHA256SUMS images/offline-images.tar.gz db/schema.sql scripts/folder-dialog-bridge.py README.md ARCHITECTURE.md ARCHITECTURE-OPTIMIZATION.md CODE-AUDIT.md)
for path in "${required[@]}"; do
  [[ -e "$bundle/$path" ]] || { echo "missing release file: $path" >&2; exit 1; }
done
(cd "$bundle" && sha256sum -c SHA256SUMS)
bash -n "$bundle"/*.sh
echo "Release archive structure and checksums: OK"
