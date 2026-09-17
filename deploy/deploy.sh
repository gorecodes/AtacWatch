#!/bin/bash
# Script di deploy automatico — lanciato dal webhook su ogni push a main.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

echo "[deploy] $(date -u +%Y-%m-%dT%H:%M:%SZ) — pull + rebuild..."
git pull
docker compose down
docker compose up -d --build
echo "[deploy] done"
