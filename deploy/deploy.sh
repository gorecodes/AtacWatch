#!/bin/bash
# Script di deploy automatico — lanciato dal webhook su ogni push a main.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

echo "[deploy] $(date -u +%Y-%m-%dT%H:%M:%SZ) — pull + rebuild..."
git pull
docker compose down

# Le migration vanno applicate PRIMA che partano app e worker, altrimenti il
# codice nuovo gira su uno schema vecchio. migrate.sh riapplica tutti i file
# ogni volta: è sicuro perché sono DDL idempotenti (create or replace /
# if not exists), e le truncate stanno dentro corpi di funzione, quindi
# scattano solo quando l'ETL le chiama.
docker compose up -d db
docker compose run --rm migrate

docker compose up -d --build
echo "[deploy] done"
