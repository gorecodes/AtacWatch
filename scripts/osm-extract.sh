#!/usr/bin/env bash
# ============================================================================
# Estrazione dei dati OSM per il geocoding (da via a via).
#
# Gira IN LOCALE, non sul VPS: osmium è pesante e i dati OSM cambiano
# lentamente, quindi si rigenera ogni qualche mese e si carica il risultato.
# Lo strumento vive in un'immagine usa-e-getta, niente installato sul sistema.
#
# Geofabrik non pubblica un estratto del solo Lazio: si scarica "centro"
# (Toscana, Umbria, Marche, Lazio, ~366 MB) e si ritaglia Roma, che scende a
# ~45 MB.
#
# Il riquadro è ricavato dall'estensione delle fermate in banca dati
# (12.2388,41.6545 → 12.7892,42.0920) allargata di circa 3 km, così restano
# geocodificabili anche gli indirizzi appena oltre le fermate più esterne.
#
# Uso:  bash scripts/osm-extract.sh [directory_di_lavoro]
# Output: strade.geojsonl, civici.geojsonl, poi.geojsonl
# ============================================================================
set -euo pipefail

WORK="${1:-$HOME/osm-work}"
BBOX="12.21,41.62,12.82,42.13"
URL="https://download.geofabrik.de/europe/italy/centro-latest.osm.pbf"
IMG="atacwatch-osm"

mkdir -p "$WORK"
cd "$WORK"

if ! docker image inspect "$IMG" >/dev/null 2>&1; then
  echo "▶ Costruisco l'immagine con osmium…"
  docker build -q -t "$IMG" - <<'DOCKERFILE'
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends osmium-tool ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /data
DOCKERFILE
fi

osmium() { docker run --rm -v "$WORK:/data" "$IMG" osmium "$@"; }

if [ ! -f centro.osm.pbf ]; then
  echo "▶ Scarico il dump OSM del centro Italia (366 MB)…"
  curl -L --fail -o centro.osm.pbf "$URL"
fi

if [ ! -s roma.osm.pbf ]; then
  # --strategy=simple: la strategia predefinita (complete_ways) tiene in RAM
  # l'indice dei nodi di TUTTO il file da 366 MB, e sul VPS da 4GB con Postgres
  # acceso viene uccisa dal kernel (uscita 137). "simple" fa una sola passata
  # con memoria minima; in cambio le vie a filo del riquadro possono perdere i
  # nodi esterni, che è irrilevante perché il riquadro è già allargato di 3 km
  # oltre le fermate più periferiche.
  echo "▶ Ritaglio Roma…"
  osmium extract --strategy=simple --bbox "$BBOX" --overwrite \
    -o /data/roma.osm.pbf /data/centro.osm.pbf
fi

# I filtri sono in due passaggi perché tags-filter mette in OR le espressioni:
# per ottenere "highway E name" serve filtrare due volte. Gli oggetti
# referenziati vengono conservati di default, altrimenti le vie perderebbero
# i nodi e quindi la geometria.

# L'indice delle posizioni dei nodi va su DISCO e non in memoria: serve a
# ricostruire la geometria delle vie, e in RAM è l'altro punto in cui
# l'estrazione viene uccisa su una macchina piccola. Su file occupa ~16 MB.
esporta() { # $1 = pbf di ingresso, $2 = geojsonl di uscita
  rm -f "$WORK/nodes.idx"
  osmium export --overwrite -f geojsonseq --add-unique-id=type_id \
    --index-type=sparse_file_array,/data/nodes.idx \
    -o "/data/$2" "/data/$1"
}

echo "▶ Strade con nome…"
osmium tags-filter --overwrite -o /data/_h.pbf     /data/roma.osm.pbf w/highway
osmium tags-filter --overwrite -o /data/strade.pbf /data/_h.pbf       w/name
esporta strade.pbf strade.geojsonl

echo "▶ Numeri civici…"
osmium tags-filter --overwrite -o /data/civici.pbf /data/roma.osm.pbf \
  n/addr:housenumber w/addr:housenumber
esporta civici.pbf civici.geojsonl

echo "▶ Punti di interesse con nome…"
osmium tags-filter --overwrite -o /data/_p.pbf /data/roma.osm.pbf \
  n/amenity n/tourism n/shop n/leisure n/railway=station n/public_transport=station \
  w/amenity w/tourism w/shop w/leisure w/railway=station
osmium tags-filter --overwrite -o /data/poi.pbf /data/_p.pbf n/name w/name
esporta poi.pbf poi.geojsonl

rm -f _h.pbf _p.pbf nodes.idx

echo
echo "▶ Fatto:"
wc -l strade.geojsonl civici.geojsonl poi.geojsonl
