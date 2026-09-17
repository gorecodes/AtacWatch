/**
 * Caricamento dei dati OSM per il geocoding.
 *
 * Prerequisito: bash scripts/osm-extract.sh (produce i tre .geojsonl).
 *
 * Uso:
 *   DATABASE_URL=... npx tsx scripts/ingest-osm.ts [directory]
 */
import { ingestOsm } from "../lib/ingest-osm";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL mancante");
  process.exit(1);
}

const dir = process.argv[2] ?? `${process.env.HOME}/osm-work`;

ingestOsm({ databaseUrl, dir, log: (m) => console.log(m) })
  .then((r) => {
    console.log("Risultato:", r);
    process.exit(0);
  })
  .catch((e) => {
    console.error("Caricamento fallito:", e);
    process.exit(1);
  });
