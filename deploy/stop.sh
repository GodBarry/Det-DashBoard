#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
load_env
compose down
echo "Det-DashBoard stopped. Persistent data was kept."
