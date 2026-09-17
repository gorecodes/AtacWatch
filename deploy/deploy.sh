#!/bin/bash
# Script di deploy automatico — lanciato dal webhook su ogni push a main.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

echo "[deploy] $(date -u +%Y-%m-%dT%H:%M:%SZ) — pull..."
git pull

# Il worker si ferma durante il build: libera memoria su una macchina da 4GB, e
# nel frattempo perde solo qualche minuto di aggiornamenti in tempo reale.
docker compose stop worker || true

# IL BUILD VIENE PRIMA DI TUTTO IL RESTO.
# Se fallisce, set -e interrompe qui e il sito resta in piedi con la versione
# precedente. Nelle prime versioni di questo script il "docker compose down"
# stava prima del build, e tre volte un build fallito ha lasciato il sito
# offline con un 521 di Cloudflare: il down aveva già spento Caddy, e non c'era
# più niente che rispondesse.
echo "[deploy] build..."
docker compose build

# Le migration vanno applicate PRIMA che riparta l'app, altrimenti il codice
# nuovo gira su uno schema vecchio. migrate.sh salta i file già registrati in
# schema_migrations, quindi rilanciarlo a ogni deploy non costa niente.
echo "[deploy] migration..."
docker compose up -d db
docker compose run --rm migrate

# up -d ricrea solo i container la cui immagine o configurazione è cambiata, e
# Caddy non viene toccato: il sito non ha un istante di buco.
# --remove-orphans ripulisce i container lasciati da un "compose run" andato
# male, che una volta hanno causato un conflitto di nomi.
echo "[deploy] avvio..."
docker compose up -d --remove-orphans

# Verifica finale: il guasto ricorrente è stato il sito giù senza che il deploy
# se ne accorgesse, quindi qui si controlla e si fallisce a voce alta.
for s in db app caddy worker; do
  if [ -z "$(docker compose ps --status running -q "$s")" ]; then
    echo "[deploy] ERRORE: il servizio $s non è in esecuzione"
    docker compose ps
    exit 1
  fi
done


# PULIZIA, E SOLO SE IL DEPLOY È ANDATO BENE (siamo dopo la verifica).
#
# Ogni build lascia le immagini precedenti di app e worker come <none>, più la
# cache di BuildKit, e nessuno le raccoglie: su una macchina con 5 GB liberi è
# questo — non i dati — che finisce lo spazio, un centinaio di MB per deploy
# più una cache che cresce senza tetto.
#
# `until=168h` tiene le immagini dell'ultima settimana: se un deploy va male si
# può ancora ripartire dall'immagine di ieri senza rifare il build. La cache
# resta entro 2 GB, così il build successivo è ancora veloce.
# `|| true`: una pulizia che fallisce non deve far fallire un deploy riuscito.
echo "[deploy] pulizia immagini e cache..."
docker image prune -f --filter "until=168h" || true
docker builder prune -f --keep-storage 2GB || true
df -h / | tail -1

echo "[deploy] done"
