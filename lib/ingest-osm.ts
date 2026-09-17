/**
 * Caricamento dei dati OSM per il geocoding.
 *
 * Legge i tre file prodotti da scripts/osm-extract.sh, li inserisce a batch
 * nella staging, e delega l'aggregazione a Postgres
 * (rebuild_places_from_staging), come fa l'ETL del GTFS.
 *
 * Due trappole del formato geojsonseq di osmium:
 *
 * 1. Ogni riga è prefissata dal separatore di record RS (0x1E), che va tolto
 *    prima di passare la riga al parser JSON.
 * 2. I file contengono anche gli oggetti REFERENZIATI, non solo quelli
 *    filtrati: nel file delle strade finiscono i nodi delle vie (attraversamenti,
 *    semafori) perché osmium li conserva per non perdere la geometria. Vanno
 *    scartati qui, controllando tag e tipo di geometria.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import postgres from "postgres";

export type IngestOsmResult = { strade: number; civici: number; poi: number; places: number };

type Feature = {
  id?: string;
  geometry?: { type: string } | null;
  properties?: Record<string, string>;
};

type Riga = {
  id: string;
  kind: string;
  name: string | null;
  street: string | null;
  housenumber: string | null;
  /** Classe OSM della strada: serve a ordinare le omonime (vedi 0021). */
  highway: string | null;
  geom: string;
};

const BATCH = 2000;

async function* leggi(path: string): AsyncGenerator<Feature> {
  const rl = createInterface({ input: createReadStream(path, "utf-8"), crlfDelay: Infinity });
  for await (const raw of rl) {
    const line = raw.replace(/^\x1e/, "").trim();
    if (!line) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // riga troncata: la salto, il geocoding non è un dato critico
    }
  }
}

async function carica(
  sql: postgres.Sql,
  path: string,
  kind: "street" | "address" | "poi",
  tieni: (p: Record<string, string>, geomType: string) => boolean,
  log: (m: string) => void,
): Promise<number> {
  let batch: Riga[] = [];
  let n = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    // La geometria arriva come GeoJSON e la converte Postgres: evita di
    // reimplementare la serializzazione WKT per punti, linee e poligoni.
    await sql`
      INSERT INTO stg_osm_feature (id, kind, name, street, housenumber, highway, geom)
      SELECT x.id, x.kind, x.name, x.street, x.housenumber, x.highway,
             st_setsrid(st_geomfromgeojson(x.geom), 4326)
      FROM jsonb_to_recordset(${sql.json(batch as unknown as never)}::jsonb) AS x(
        id text, kind text, name text, street text, housenumber text,
        highway text, geom text
      )
    `;
    n += batch.length;
    batch = [];
  };

  for await (const ft of leggi(path)) {
    const p = ft.properties ?? {};
    const g = ft.geometry;
    if (!g || !ft.id) continue;
    if (!tieni(p, g.type)) continue;

    batch.push({
      id: ft.id,
      kind,
      name: p.name ?? null,
      street: p["addr:street"] ?? null,
      housenumber: p["addr:housenumber"] ?? null,
      highway: p.highway ?? null,
      geom: JSON.stringify(g),
    });

    if (batch.length >= BATCH) {
      await flush();
      if (n % 20000 === 0) log(`  ${kind}: ${n} righe…`);
    }
  }
  await flush();
  log(`  ${kind}: ${n} righe`);
  return n;
}

export async function ingestOsm(opts: {
  databaseUrl: string;
  dir: string;
  log?: (m: string) => void;
}): Promise<IngestOsmResult> {
  const log = opts.log ?? (() => {});
  const sql = postgres(opts.databaseUrl, { ssl: false, max: 4, idle_timeout: 60 });

  try {
    log("Svuoto la staging…");
    await sql`TRUNCATE stg_osm_feature`;

    log("Carico le strade…");
    const strade = await carica(
      sql,
      `${opts.dir}/strade.geojsonl`,
      "street",
      // Solo vie con nome e geometria lineare: scarta i nodi referenziati.
      (p, t) => Boolean(p.name) && Boolean(p.highway) && t === "LineString",
      log,
    );

    log("Carico i civici…");
    const civici = await carica(
      sql,
      `${opts.dir}/civici.geojsonl`,
      "address",
      (p) => Boolean(p["addr:housenumber"]),
      log,
    );

    log("Carico i punti di interesse…");
    const poi = await carica(
      sql,
      `${opts.dir}/poi.geojsonl`,
      "poi",
      (p) => Boolean(p.name) && Boolean(p.amenity || p.tourism || p.shop || p.leisure || p.railway),
      log,
    );

    log("Aggrego in places (clustering delle vie)…");
    // Il clustering spaziale su decine di migliaia di segmenti supera lo
    // statement_timeout di default, come il rebuild del GTFS.
    await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '15min'`;
      await tx`SELECT rebuild_places_from_staging()`;
    });

    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM places`;
    log(`Fatto: ${n} voci in places`);
    return { strade, civici, poi, places: n };
  } finally {
    await sql.end({ timeout: 10 });
  }
}
