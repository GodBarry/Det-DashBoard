#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
docker-compose --env-file .env -f compose.yml ps
curl --fail --silent --show-error http://127.0.0.1:5173/api/health/live
echo
curl --fail --silent --show-error http://127.0.0.1:5173/api/health/ready
echo
docker exec det-dashboard-postgres psql -U "$(sed -n 's/^POSTGRES_USER=//p' .env)" -d "$(sed -n 's/^POSTGRES_DB=//p' .env)" -c 'select count(*) as project_count from projects;'
