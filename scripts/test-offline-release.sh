#!/usr/bin/env bash
set -euo pipefail

archive="${1:-}"
[[ -n "$archive" && -f "$archive" ]] || { echo "Usage: $0 release-dist/det-dashboard-*.tar.gz" >&2; exit 1; }
work="$(mktemp -d /tmp/det-dashboard-offline-e2e.XXXXXX)"
bundle=""
cleanup() {
  if [[ -n "$bundle" && -f "$bundle/.env" ]]; then
    (cd "$bundle" && ./stop.sh >/dev/null 2>&1) || true
  fi
  docker run --rm -v "$work:/cleanup" det-dashboard-postgres:16 sh -c 'rm -rf /cleanup/* /cleanup/.[!.]* /cleanup/..?*' >/dev/null 2>&1 || true
  rmdir "$work" >/dev/null 2>&1 || true
}
trap cleanup EXIT

tar -xzf "$archive" -C "$work"
bundle="$(find "$work" -mindepth 1 -maxdepth 1 -type d | head -1)"
cp "$bundle/env.example" "$bundle/.env"
suffix="$$"
sed -i "s|^COMPOSE_PROJECT_NAME=.*|COMPOSE_PROJECT_NAME=det-dashboard-release-test-$suffix|" "$bundle/.env"
grep -q '^COMPOSE_PROJECT_NAME=' "$bundle/.env" || echo "COMPOSE_PROJECT_NAME=det-dashboard-release-test-$suffix" >>"$bundle/.env"
sed -i 's/^APP_PORT=.*/APP_PORT=15174/' "$bundle/.env"
sed -i 's|^HOST_BROWSE_ROOT=.*|HOST_BROWSE_ROOT=/tmp|' "$bundle/.env"
sed -i 's/^FORCE_OFFLINE_IMAGE_LOAD=.*/FORCE_OFFLINE_IMAGE_LOAD=true/' "$bundle/.env"

(cd "$bundle" && ./start.sh)
curl -fsS http://127.0.0.1:15174/api/health/ready >/dev/null
name="offline-persist-$suffix"
curl -fsS -X POST -H 'content-type: application/json' -d "{\"name\":\"$name\"}" http://127.0.0.1:15174/api/projects >/dev/null
(cd "$bundle" && docker compose --env-file .env -f compose.yml restart app >/dev/null)
for _ in $(seq 1 30); do
  curl -fsS http://127.0.0.1:15174/api/health/ready >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS http://127.0.0.1:15174/api/projects | grep -q "$name"

(cd "$bundle" && ./backup.sh)
backup="$(find "$bundle/backups" -name 'det-dashboard-backup-*.tar.gz' | sort | tail -1)"
[[ -s "$backup" ]]
mutated="offline-after-backup-$suffix"
curl -fsS -X POST -H 'content-type: application/json' -d "{\"name\":\"$mutated\"}" http://127.0.0.1:15174/api/projects >/dev/null
(cd "$bundle" && ./restore.sh "$backup")
projects="$(curl -fsS http://127.0.0.1:15174/api/projects)"
grep -q "$name" <<<"$projects"
if grep -q "$mutated" <<<"$projects"; then
  echo "restore test failed: post-backup mutation still exists" >&2
  exit 1
fi
(cd "$bundle" && ./diagnose.sh >/dev/null)
echo "Offline release cold start, persistence, backup and restore: OK"
