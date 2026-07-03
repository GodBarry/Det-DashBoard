#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
check_docker
load_env
compose ps
echo
if compose exec -T app node -e 'fetch("http://127.0.0.1:4177/api/health/ready").then((response) => { if (!response.ok) process.exit(1); return response.text(); }).then(console.log).catch(() => process.exit(1))'; then
  echo
  echo "Application readiness: OK"
else
  echo "Application readiness: FAILED" >&2
  exit 1
fi
