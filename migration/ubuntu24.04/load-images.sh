#!/usr/bin/env bash
set -euo pipefail
podman load -i ./images/postgres-16.tar
podman load -i ./images/minio-latest.tar
podman image ls det-dashboard-postgres det-dashboard-minio
