#!/usr/bin/env bash
set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
  echo "apt-get not found. This script is intended for Ubuntu/Debian."
  exit 1
fi

sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

echo
echo "Docker installed."
echo "Run this in the current terminal to refresh group membership:"
echo "  newgrp docker"
echo
echo "Then verify:"
echo "  docker --version"
echo "  docker compose version"
