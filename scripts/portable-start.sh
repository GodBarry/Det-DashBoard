#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-$ROOT_DIR/.env.portable}"
if [[ -f "$COMPOSE_ENV_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    value="${value#\"}"; value="${value%\"}"
    value="${value#\'}"; value="${value%\'}"
    if [[ ! -v "$key" ]]; then
      printf -v "$key" '%s' "$value"
      export "$key"
    fi
  done <"$COMPOSE_ENV_FILE"
else
  COMPOSE_ENV_FILE=/dev/null
fi

mkdir -p datasets exports portable-data/storage portable-data/postgres portable-data/minio

if [ -z "${DATASETS_DIR:-}" ]; then
  if [ -d "/home/barry/图片" ]; then
    export DATASETS_DIR="/home/barry/图片"
  else
    export DATASETS_DIR="$ROOT_DIR/datasets"
  fi
fi

export DATA_ROOT_DISPLAY="${DATA_ROOT_DISPLAY:-$DATASETS_DIR}"
export HOST_BROWSE_ROOT="${HOST_BROWSE_ROOT:-/}"
export BROWSE_ROOT_DISPLAY="${BROWSE_ROOT_DISPLAY:-$HOST_BROWSE_ROOT}"
export LOCAL_UID="${LOCAL_UID:-$(id -u)}"
export LOCAL_GID="${LOCAL_GID:-$(id -g)}"
export EXPORTS_DIR="${EXPORTS_DIR:-$ROOT_DIR/exports}"
if [[ "$EXPORTS_DIR" != /* ]]; then
  export EXPORTS_DIR="$ROOT_DIR/${EXPORTS_DIR#./}"
fi
export EXPORT_ROOT_DISPLAY="${EXPORT_ROOT_DISPLAY:-$EXPORTS_DIR}"
if [[ "$EXPORT_ROOT_DISPLAY" != /* ]]; then
  export EXPORT_ROOT_DISPLAY="$ROOT_DIR/${EXPORT_ROOT_DISPLAY#./}"
fi
export HOST_DIALOG_URL=""
export NATIVE_DIALOG_MODE="disabled"
export FOLDER_DIALOG_ALLOWED_ORIGINS="${FOLDER_DIALOG_ALLOWED_ORIGINS:-http://localhost:${APP_PORT:-5173},http://127.0.0.1:${APP_PORT:-5173}}"

DIALOG_PID_FILE="$ROOT_DIR/portable-data/folder-dialog.pid"
DIALOG_LOG_FILE="$ROOT_DIR/portable-data/folder-dialog.log"
if command -v node >/dev/null 2>&1 && command -v zenity >/dev/null 2>&1 && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
  if [[ -f "$DIALOG_PID_FILE" ]] && kill -0 "$(<"$DIALOG_PID_FILE")" 2>/dev/null; then
    export HOST_DIALOG_URL="http://127.0.0.1:4178"
    export NATIVE_DIALOG_MODE="bridge"
  else
    nohup node "$ROOT_DIR/scripts/folder-dialog-bridge.js" >"$DIALOG_LOG_FILE" 2>&1 &
    DIALOG_PID=$!
    sleep 0.2
    if kill -0 "$DIALOG_PID" 2>/dev/null; then
      echo "$DIALOG_PID" >"$DIALOG_PID_FILE"
      export HOST_DIALOG_URL="http://127.0.0.1:4178"
      export NATIVE_DIALOG_MODE="bridge"
    else
      echo "Native folder dialog bridge failed to start; web folder picker will be used." >&2
    fi
  fi
else
  echo "Node.js/zenity/desktop session unavailable; web folder picker will be used." >&2
fi

if [[ "${BUILD_LOCAL_IMAGE:-true}" == "true" ]]; then
  docker compose --env-file "$COMPOSE_ENV_FILE" -f docker-compose.portable.yml up --build -d --wait
else
  docker compose --env-file "$COMPOSE_ENV_FILE" -f docker-compose.portable.yml pull app
  docker compose --env-file "$COMPOSE_ENV_FILE" -f docker-compose.portable.yml up --no-build -d --wait
fi

echo "Det-DashBoard is running at http://localhost:${APP_PORT:-5173}"
echo "Datasets mounted from: $DATASETS_DIR"
echo "Browse root mounted from: $HOST_BROWSE_ROOT"
if [[ -n "$HOST_DIALOG_URL" ]]; then
  echo "Native folder dialog bridge: $HOST_DIALOG_URL"
else
  echo "Native folder dialog bridge: unavailable (web picker enabled)"
fi
