/**
 * ETL del GTFS statico di Roma -> staging -> aggregazione (opzione C).
 *
 * Strategia: la funzione NON aggrega in memoria. Fa streaming dello zip,
 * inserisce a batch nelle tabelle stg_*, e poi delega l'aggregazione pesante
 * a Postgres (rebuild_static_from_staging()).
 *
 * Riutilizzata da:
 *   - scripts/ingest-static.ts  (pnpm ingest:static)
 *   - systemd timer sul VPS     (deploy/atacwatch-ingest.{service,timer})
 */
import postgres from "postgres";
import yauzl from "yauzl";
import { parse } from "csv-parse";
import { gtfsTimeToSeconds } from "./gtfs";

const GTFS_URL = "https://romamobilita.it/sites/default/files/rome_static_gtfs.zip";
const BATCH = 2000;

type Logger = (msg: string) => void;
const noop: Logger = () => {};

// ---- helpers di parsing -----------------------------------------------------

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function gtfsDate(v: string | undefined): string | null {
  // "20240115" -> "2024-01-15"
  if (!v || !/^\d{8}$/.test(v)) return null;
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}

const bool = (v: string | undefined) => v === "1";

// ---- accesso allo zip (yauzl) ----------------------------------------------

type ZipFile = yauzl.ZipFile;

function openZip(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("zip non valido"));
      resolve(zip);
    });
  });
}

function collectEntries(zip: ZipFile): Promise<Map<string, yauzl.Entry>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, yauzl.Entry>();
    zip.on("entry", (e: yauzl.Entry) => {
      entries.set(e.fileName, e);
      zip.readEntry();
    });
    zip.on("end", () => resolve(entries));
    zip.on("error", reject);
    zip.readEntry();
  });
}

function openEntryStream(zip: ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(err ?? new Error("stream non disponibile"));
      resolve(stream);
    });
  });
}

/**
 * Streama un CSV dallo zip e inserisce a batch i record mappati. La memoria
 * resta limitata: `await flush` applica backpressure all'iterazione.
 */
async function streamCsvToStaging<T extends Record<string, unknown>>(
  zip: ZipFile,
  entries: Map<string, yauzl.Entry>,
  fileName: string,
  map: (rec: Record<string, string>) => T | null,
  flush: (rows: T[]) => Promise<void>,
  log: Logger,
): Promise<number> {
  const entry = entries.get(fileName);
  if (!entry) {
    log(`  (${fileName} assente, salto)`);
    return 0;
  }
  const stream = await openEntryStream(zip, entry);
  const parser = stream.pipe(
    parse({ columns: true, skip_empty_lines: true, trim: true, bom: true }),
  );

  let buffer: T[] = [];
  let total = 0;
  for await (const rec of parser as AsyncIterable<Record<string, string>>) {
    const row = map(rec);
    if (!row) continue;
    buffer.push(row);
    if (buffer.length >= BATCH) {
      await flush(buffer);
      total += buffer.length;
      buffer = [];
    }
  }
  if (buffer.length) {
    await flush(buffer);
    total += buffer.length;
  }
  log(`  ${fileName}: ${total} righe`);
  return total;
}

// ---- ETL principale ---------------------------------------------------------

export type IngestResult = {
  routes: number;
  stops: number;
  trips: number;
  stopTimes: number;
  shapes: number;
  durationMs: number;
};

export async function ingestStatic(opts: {
  databaseUrl: string;
  log?: Logger;
}): Promise<IngestResult> {
  const log = opts.log ?? noop;
  const started = Date.now();

  log("Scarico il GTFS statico…");
  const res = await fetch(GTFS_URL);
  if (!res.ok) throw new Error(`download fallito: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  log(`  zip: ${(buffer.length / 1e6).toFixed(1)} MB`);

  const zip = await openZip(buffer);
  const entries = await collectEntries(zip);

  const sql = postgres(opts.databaseUrl, { ssl: false, prepare: false, max: 4 });

  try {
    log("Svuoto le tabelle di staging…");
    await sql`truncate stg_routes, stg_stops, stg_trips, stg_stop_times, stg_shapes, stg_calendar, stg_calendar_dates`;

    log("Carico le staging (streaming)…");

    const routes = await streamCsvToStaging(
      zip, entries, "routes.txt",
      (r) => ({
        route_id: r.route_id,
        agency_id: r.agency_id ?? null,
        route_short_name: r.route_short_name ?? null,
        route_long_name: r.route_long_name ?? null,
        route_type: num(r.route_type),
        route_color: r.route_color ?? null,
        route_text_color: r.route_text_color ?? null,
      }),
      (rows) => sql`insert into stg_routes ${sql(rows, "route_id", "agency_id", "route_short_name", "route_long_name", "route_type", "route_color", "route_text_color")}`.then(() => {}),
      log,
    );

    const stops = await streamCsvToStaging(
      zip, entries, "stops.txt",
      (r) => {
        const lat = num(r.stop_lat), lon = num(r.stop_lon);
        if (lat == null || lon == null) return null;
        return { stop_id: r.stop_id, stop_code: r.stop_code ?? null, stop_name: r.stop_name ?? null, stop_lat: lat, stop_lon: lon };
      },
      (rows) => sql`insert into stg_stops ${sql(rows, "stop_id", "stop_code", "stop_name", "stop_lat", "stop_lon")}`.then(() => {}),
      log,
    );

    await streamCsvToStaging(
      zip, entries, "calendar.txt",
      (r) => ({
        service_id: r.service_id,
        monday: bool(r.monday), tuesday: bool(r.tuesday), wednesday: bool(r.wednesday),
        thursday: bool(r.thursday), friday: bool(r.friday), saturday: bool(r.saturday), sunday: bool(r.sunday),
        start_date: gtfsDate(r.start_date), end_date: gtfsDate(r.end_date),
      }),
      (rows) => sql`insert into stg_calendar ${sql(rows, "service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date")}`.then(() => {}),
      log,
    );

    await streamCsvToStaging(
      zip, entries, "calendar_dates.txt",
      (r) => ({ service_id: r.service_id, date: gtfsDate(r.date), exception_type: num(r.exception_type) }),
      (rows) => sql`insert into stg_calendar_dates ${sql(rows, "service_id", "date", "exception_type")}`.then(() => {}),
      log,
    );

    const trips = await streamCsvToStaging(
      zip, entries, "trips.txt",
      (r) => ({
        trip_id: r.trip_id, route_id: r.route_id, service_id: r.service_id,
        trip_headsign: r.trip_headsign ?? null,
        direction_id: num(r.direction_id), shape_id: r.shape_id ?? null,
      }),
      (rows) => sql`insert into stg_trips ${sql(rows, "trip_id", "route_id", "service_id", "trip_headsign", "direction_id", "shape_id")}`.then(() => {}),
      log,
    );

    const shapes = await streamCsvToStaging(
      zip, entries, "shapes.txt",
      (r) => {
        const lat = num(r.shape_pt_lat), lon = num(r.shape_pt_lon), seq = num(r.shape_pt_sequence);
        if (lat == null || lon == null || seq == null) return null;
        return { shape_id: r.shape_id, lat, lon, seq };
      },
      (rows) => sql`insert into stg_shapes ${sql(rows, "shape_id", "lat", "lon", "seq")}`.then(() => {}),
      log,
    );

    const stopTimes = await streamCsvToStaging(
      zip, entries, "stop_times.txt",
      (r) => {
        const seq = num(r.stop_sequence);
        const dep = gtfsTimeToSeconds(r.departure_time || r.arrival_time);
        if (seq == null) return null;
        return { trip_id: r.trip_id, stop_id: r.stop_id, stop_sequence: seq, departure_s: dep };
      },
      (rows) => sql`insert into stg_stop_times ${sql(rows, "trip_id", "stop_id", "stop_sequence", "departure_s")}`.then(() => {}),
      log,
    );

    log("Aggrego le staging in Postgres (rebuild_static_from_staging)…");
    // Il rebuild è un job batch pesante (aggregazioni su milioni di righe +
    // st_makeline sulle shapes): supera lo statement_timeout di default della
    // connessione. Lo disattivo solo per questa transazione (SET LOCAL: vale
    // anche col pooler in transaction mode), così arriva sempre in fondo.
    await sql.begin(async (tx) => {
      await tx`set local statement_timeout = 0`;
      await tx`select rebuild_static_from_staging()`;
    });

    const durationMs = Date.now() - started;
    log(`Fatto in ${(durationMs / 1000).toFixed(1)}s`);
    return { routes, stops, trips, stopTimes, shapes, durationMs };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
