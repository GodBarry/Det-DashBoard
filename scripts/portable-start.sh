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
export HOST_DIALOG_TOKEN="${HOST_DIALOG_TOKEN:-$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')}"
export NATIVE_DIALOG_MODE="disabled"
export FOLDER_DIALOG_ALLOWED_ORIGINS="${FOLDER_DIALOG_ALLOWED_ORIGINS:-http://localhost:${APP_PORT:-5173},http://127.0.0.1:${APP_PORT:-5173}}"

DIALOG_PID_FILE="$ROOT_DIR/portable-data/folder-dialog.pid"
DIALOG_LOG_FILE="$ROOT_DIR/portable-data/folder-dialog.log"
if command -v python3 >/dev/null 2>&1 && command -v zenity >/dev/null 2>&1 && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
  if [[ -f "$DIALOG_PID_FILE" ]] && kill -0 "$(<"$DIALOG_PID_FILE")" 2>/dev/null; then
    OLD_DIALOG_PID="$(<"$DIALOG_PID_FILE")"
    kill "$OLD_DIALOG_PID" 2>/dev/null || true
    for _ in {1..20}; do
      kill -0 "$OLD_DIALOG_PID" 2>/dev/null || break
      sleep 0.1
    done
  fi
  FOLDER_DIALOG_HOST=0.0.0.0 FOLDER_DIALOG_TOKEN="$HOST_DIALOG_TOKEN" nohup python3 "$ROOT_DIR/scripts/folder-dialog-bridge.py" >"$DIALOG_LOG_FILE" 2>&1 &
  DIALOG_PID=$!
  sleep 0.5
  if kill -0 "$DIALOG_PID" 2>/dev/null; then
    echo "$DIALOG_PID" >"$DIALOG_PID_FILE"
    export HOST_DIALOG_URL="http://host.docker.internal:4178"
    export NATIVE_DIALOG_MODE="bridge"
  else
    echo "Native file dialog bridge failed to start; web folder picker will be used." >&2
  fi
else
  echo "Python 3, zenity or a desktop session is unavailable; manual paths and the web folder picker remain available." >&2
fi

if [[ "${BUILD_LOCAL_IMAGE:-true}" == "true" ]]; then
  docker compose --env-file "$COMPOSE_ENV_FILE" -f docker-compose.portable.yml up --build -d --wait
else
  docker compose --env-file "$COMPOSE_ENV_FILE" -f docker-compose.portable.yml pull app
  docker compose --env-file "$COMPOSE_ENV_FILE" -f docker-compose.portable.yml up --no-build -d --wait
fi

if [[ "$NATIVE_DIALOG_MODE" == "bridge" ]]; then
  docker compose --env-file "$COMPOSE_ENV_FILE" -f docker-compose.portable.yml exec -T app node -e \
    "fetch(process.env.HOST_DIALOG_URL + '/health', {headers:{'x-dialog-token':process.env.HOST_DIALOG_TOKEN}}).then(r=>process.exit(r.status===404?0:1)).catch(()=>process.exit(1))" \
    || { echo "Native file dialog bridge is not reachable from the app container." >&2; exit 1; }
  echo "Native Ubuntu file picker bridge verified."
fi

echo "Det-DashBoard is running at http://localhost:${APP_PORT:-5173}"
echo "Datasets mounted from: $DATASETS_DIR"
echo "Browse root mounted from: $HOST_BROWSE_ROOT"
if [[ -n "$HOST_DIALOG_URL" ]]; then
  echo "Native folder dialog bridge: $HOST_DIALOG_URL"
else
  echo "Native folder dialog bridge: unavailable (web picker enabled)"
fi
