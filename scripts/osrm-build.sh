#!/usr/bin/env bash
# ============================================================================
# Prepara i dati di routing pedonale per OSRM.
#
# Serve al calcolo percorsi: le distanze in linea d'aria non sbagliavano solo
# il numero mostrato ma gli itinerari. Su SALARIA/CASTEL GIUBILEO la linea
# d'aria dava 396 metri dove la strada reale è 4475, cioè sei minuti invece di
# 56, e il router presentava come migliore un percorso impossibile.
#
# Va eseguito una volta (e poi a ogni aggiornamento dei dati OSM, cioè ogni
# qualche mese). Produce ./osrm nella radice del repo, che docker-compose monta
# in sola lettura nel container.
#
# MEMORIA. osrm-extract arriva a ~720 MB di picco. Su una macchina da 4GB con
# Postgres attivo conviene fermare il worker prima:
#     docker compose stop worker && bash scripts/osrm-build.sh && docker compose up -d
# A regime il servizio consuma molto meno — misurato 163 MB — perché
# osrm-routed mappa i dati da disco invece di caricarli.
#
# Prerequisito: roma.osm.pbf, prodotto da scripts/osm-extract.sh.
#
# Uso:  bash scripts/osrm-build.sh [directory_con_roma.osm.pbf]
# ============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$HOME/osm-work}"
DEST="$REPO_DIR/osrm"
IMG="osrm/osrm-backend"

if [ ! -s "$SRC/roma.osm.pbf" ]; then
  echo "roma.osm.pbf non trovato in $SRC — esegui prima scripts/osm-extract.sh" >&2
  exit 1
fi

mkdir -p "$DEST"

# Se il servizio è stato avviato prima che questa cartella esistesse, Docker
# l'ha creata lui e appartiene a root: mkdir non se ne lamenta e l'errore
# arriva più tardi come un "Permission denied" del cp, che non dice perché.
if [ ! -w "$DEST" ]; then
  echo "La cartella $DEST non è scrivibile: l'ha creata Docker come root." >&2
  echo "Rimuovila e rilancia:  sudo rm -rf '$DEST' && bash $0 $SRC" >&2
  exit 1
fi

cp "$SRC/roma.osm.pbf" "$DEST/"

osrm() { docker run --rm -v "$DEST:/data" "$IMG" "$@"; }

echo "▶ Estrazione del grafo pedonale (è il passo che consuma memoria)…"
osrm osrm-extract -p /opt/foot.lua /data/roma.osm.pbf

# MLD invece di CH: la preparazione è molto più leggera, e per tratte brevi
# come le nostre la differenza di velocità in interrogazione è irrilevante.
echo "▶ Partizionamento…"
osrm osrm-partition /data/roma.osrm
echo "▶ Personalizzazione…"
osrm osrm-customize /data/roma.osrm

# Il pbf non serve a osrm-routed e sono 44 MB di troppo nel volume montato.
rm -f "$DEST/roma.osm.pbf"

echo
echo "▶ Fatto. Dati in $DEST:"
du -sh "$DEST"
echo
echo "Avvia il servizio con:  docker compose up -d osrm"
