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
# LA CACHE DI BUILD È IL VERO CONSUMATORE, non le immagini. Misurato sul VPS:
# 18,6 GB in 127 record dopo una giornata di deploy, perché ogni build di Next
# lascia diversi strati da ~800 MB. Con le immagini vecchie sopra,
# /var/lib/containerd era arrivato a 21 GB su un disco da 29.
#
# La prima versione di questa pulizia usava `--keep-storage`, che è deprecato e
# su alcune versioni non viene accettato, DENTRO un `|| true` che ne nascondeva
# il fallimento: per giorni ha stampato "pulizia" senza pulire niente. Da qui
# due regole:
#   1. il flag si sceglie guardando cosa il docker installato accetta davvero;
#   2. se la pulizia falla lo si SCRIVE, perché una pulizia muta che non
#      funziona è peggio di non averla.
echo "[deploy] pulizia immagini e cache..."

# Immagini senza tag più vecchie di una settimana. La finestra serve a poter
# ripartire dall'immagine di ieri senza rifare il build, se un deploy va male.
docker image prune -f --filter "until=168h" || echo "[deploy] ATTENZIONE: image prune fallito"

# Tetto alla cache di BuildKit. Il nome del flag è cambiato tra le versioni:
# si usa quello che c'è, e se non c'è nessuno dei due si butta tutta la cache —
# costa qualche minuto al prossimo build, che su questa macchina è un baratto
# che conviene sempre.
AIUTO="$(docker builder prune --help 2>&1 || true)"
if grep -q -- "--max-used-space" <<<"$AIUTO"; then
  docker builder prune -f --max-used-space 2GB || echo "[deploy] ATTENZIONE: builder prune fallito"
elif grep -q -- "--keep-storage" <<<"$AIUTO"; then
  docker builder prune -f --keep-storage 2GB || echo "[deploy] ATTENZIONE: builder prune fallito"
else
  echo "[deploy] nessun flag di tetto disponibile: butto tutta la cache"
  docker builder prune -af || echo "[deploy] ATTENZIONE: builder prune fallito"
fi

# Rete di sicurezza. Se nonostante tutto lo spazio libero scende sotto la
# soglia, si pulisce senza riguardi: l'ETL notturno del GTFS ha un picco
# transitorio di mezzo giga e senza spazio fallisce, lasciando l'app su un
# feed vecchio.
LIBERI="$(df -B1 --output=avail / | tail -1 | tr -d ' ')"
SOGLIA=$((5 * 1024 * 1024 * 1024))
if [ "$LIBERI" -lt "$SOGLIA" ]; then
  echo "[deploy] spazio libero sotto i 5 GB: pulizia senza riguardi"
  docker builder prune -af || true
  docker image prune -f || true
fi

df -h /
docker system df

echo "[deploy] done"
