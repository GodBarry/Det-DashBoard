#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-$ROOT_DIR/.env.portable}"
if [[ ! -f "$COMPOSE_ENV_FILE" ]]; then
  COMPOSE_ENV_FILE=/dev/null
fi

docker compose --env-file "$COMPOSE_ENV_FILE" -f docker-compose.portable.yml down

DIALOG_PID_FILE="$ROOT_DIR/portable-data/folder-dialog.pid"
if [[ -f "$DIALOG_PID_FILE" ]]; then
  DIALOG_PID="$(<"$DIALOG_PID_FILE")"
  if kill -0 "$DIALOG_PID" 2>/dev/null; then
    kill "$DIALOG_PID"
  fi
  rm -f "$DIALOG_PID_FILE"
fi
