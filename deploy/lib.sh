#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${DET_DASHBOARD_ENV:-$ROOT_DIR/.env}"
COMPOSE_FILE="$ROOT_DIR/compose.yml"
GPU_FILE="$ROOT_DIR/compose.gpu.yml"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

random_secret() {
  od -An -N24 -tx1 /dev/urandom | tr -d ' \n'
}

set_env_value() {
  local key="$1" value="$2" tmp
  tmp="${ENV_FILE}.tmp.$$"
  awk -v key="$key" -v value="$value" '
    BEGIN { found=0 }
    index($0, key "=")==1 { print key "=" value; found=1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$ENV_FILE" >"$tmp"
  mv "$tmp" "$ENV_FILE"
}

absolute_path() {
  local value="$1"
  if [[ "$value" = /* ]]; then
    printf '%s\n' "$value"
  else
    printf '%s/%s\n' "$ROOT_DIR" "${value#./}"
  fi
}

load_env() {
  [[ -f "$ENV_FILE" ]] || cp "$ROOT_DIR/env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

initialize_env() {
  load_env
  if [[ "${POSTGRES_PASSWORD:-}" == "GENERATE_ON_FIRST_START" || -z "${POSTGRES_PASSWORD:-}" ]]; then
    set_env_value POSTGRES_PASSWORD "$(random_secret)"
  fi
  if [[ "${MINIO_ROOT_PASSWORD:-}" == "GENERATE_ON_FIRST_START" || -z "${MINIO_ROOT_PASSWORD:-}" ]]; then
    set_env_value MINIO_ROOT_PASSWORD "$(random_secret)"
  fi
  if [[ "${HOST_DIALOG_TOKEN:-}" == "GENERATE_ON_FIRST_START" || -z "${HOST_DIALOG_TOKEN:-}" ]]; then
    set_env_value HOST_DIALOG_TOKEN "$(random_secret)"
  fi
  set_env_value LOCAL_UID "$(id -u)"
  set_env_value LOCAL_GID "$(id -g)"
  load_env
  for key in DATASETS_DIR EXPORTS_DIR APP_STORAGE_DIR POSTGRES_DATA_DIR MINIO_DATA_DIR HOST_MODEL_ROOT HOST_PYTHON_ROOT; do
    set_env_value "$key" "$(absolute_path "${!key}")"
  done
  if [[ "${HOST_BROWSE_ROOT:-/home}" == "/home" && -n "${HOME:-}" ]]; then
    set_env_value HOST_BROWSE_ROOT "$HOME"
  fi
  load_env
}

compose() {
  local files=(-f "$COMPOSE_FILE")
  if [[ "${ENABLE_GPU:-false}" == "true" ]]; then
    files+=(-f "$GPU_FILE")
  fi
  docker compose --env-file "$ENV_FILE" "${files[@]}" "$@"
}

ensure_directories() {
  mkdir -p "$DATASETS_DIR" "$EXPORTS_DIR" "$APP_STORAGE_DIR" "$POSTGRES_DATA_DIR" "$MINIO_DATA_DIR" "$HOST_MODEL_ROOT" "$HOST_PYTHON_ROOT" "$ROOT_DIR/backups"
}

check_docker() {
  need docker
  docker info >/dev/null 2>&1 || die "Docker daemon is unavailable or this user cannot access it"
  docker compose version >/dev/null 2>&1 || die "Docker Compose plugin is required"
}

load_offline_images() {
  local archive="$ROOT_DIR/images/offline-images.tar.gz"
  if [[ "${FORCE_OFFLINE_IMAGE_LOAD:-false}" != "true" ]] \
    && docker image inspect "${APP_IMAGE}" >/dev/null 2>&1 \
    && docker image inspect "${POSTGRES_IMAGE}" >/dev/null 2>&1 \
    && docker image inspect "${MINIO_IMAGE}" >/dev/null 2>&1; then
    return
  fi
  [[ -f "$archive" ]] || die "Required images are missing and $archive was not found"
  echo "Loading offline Docker images (this can take a few minutes)..."
  docker load -i "$archive"
}

check_gpu() {
  [[ "${ENABLE_GPU:-false}" == "true" ]] || return 0
  command -v nvidia-smi >/dev/null 2>&1 || die "ENABLE_GPU=true but nvidia-smi is unavailable"
  docker info 2>/dev/null | grep -qi nvidia || die "NVIDIA Container Toolkit is not configured for Docker"
}

start_dialog_bridge() {
  local pid_file="$ROOT_DIR/portable-data/folder-dialog.pid"
  local log_file="$ROOT_DIR/portable-data/folder-dialog.log"
  set_env_value HOST_DIALOG_URL ""
  set_env_value NATIVE_DIALOG_MODE disabled
  if ! command -v python3 >/dev/null 2>&1 || ! command -v zenity >/dev/null 2>&1 || [[ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
    echo "Native Ubuntu picker unavailable (requires host Python 3, zenity and a desktop session); manual path input remains available." >&2
    load_env
    return 0
  fi
  if [[ -f "$pid_file" ]] && kill -0 "$(<"$pid_file")" 2>/dev/null; then
    local old_dialog_pid
    old_dialog_pid="$(<"$pid_file")"
    kill "$old_dialog_pid" 2>/dev/null || true
    for _ in {1..20}; do
      kill -0 "$old_dialog_pid" 2>/dev/null || break
      sleep 0.1
    done
  fi
  FOLDER_DIALOG_HOST=0.0.0.0 FOLDER_DIALOG_TOKEN="$HOST_DIALOG_TOKEN" nohup python3 "$ROOT_DIR/scripts/folder-dialog-bridge.py" >"$log_file" 2>&1 &
  local dialog_pid=$!
  sleep 0.5
  if kill -0 "$dialog_pid" 2>/dev/null; then
    echo "$dialog_pid" >"$pid_file"
    set_env_value HOST_DIALOG_URL "http://host.docker.internal:4178"
    set_env_value NATIVE_DIALOG_MODE bridge
  else
    echo "Native Ubuntu picker failed to start; see $log_file" >&2
  fi
  load_env
}

stop_dialog_bridge() {
  local pid_file="$ROOT_DIR/portable-data/folder-dialog.pid"
  if [[ -f "$pid_file" ]]; then
    local dialog_pid
    dialog_pid="$(<"$pid_file")"
    kill "$dialog_pid" 2>/dev/null || true
    rm -f "$pid_file"
  fi
}
