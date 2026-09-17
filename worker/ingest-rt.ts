/**
 * ingest-rt — polling dei feed GTFS-RT di Roma.
 *
 * Porta Node.js della Supabase Edge Function (supabase/functions/ingest-rt/).
 * Scarica i 3 feed .pb, decodifica protobuf, upsert nelle tabelle realtime.
 * Chiamata da worker/index.ts ogni 60 secondi.
 */
import type postgres from "postgres";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

// gtfs-realtime-bindings è CommonJS: importiamo come default e destructuriamo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { transit_realtime } = GtfsRealtimeBindings as any;

// Valori scheduleRelationship (GTFS-RT). Numeri grezzi per indipendenza dalla
// struttura interna del pacchetto (che cambia tra versioni).
const TRIP_CANCELED = 3; // TripDescriptor.ScheduleRelationship.CANCELED
const STU_SKIPPED = 1;   // StopTimeUpdate.ScheduleRelationship.SKIPPED
// NB: NO_DATA (2) NON va scartata: Roma marca così i CAPOLINEA, che portano
// comunque l'orario statico. Scartandoli si perdeva l'ultima fermata della corsa.

const BASE = "https://romamobilita.it/sites/default/files";
const FEEDS = {
  vehicles: `${BASE}/rome_rtgtfs_vehicle_positions_feed.pb`,
  trips:    `${BASE}/rome_rtgtfs_trip_updates_feed.pb`,
  alerts:   `${BASE}/rome_rtgtfs_service_alerts_feed.pb`,
};

// 64-bit protobuf (Long) o number → number | null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toNum(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v?.toNumber === "function") return v.toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function tsToIso(sec: number | null): string | null {
  return sec ? new Date(sec * 1000).toISOString() : null;
}

async function fetchFeed(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} su ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return transit_realtime.FeedMessage.decode(buf);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface IngestStats {
  vehicles: number;
  tripUpdates: number;
  alerts: number;
}

export async function ingestRt(sql: postgres.Sql): Promise<{ ok: true; stats: IngestStats } | { ok: false; error: string }> {
  const stats: IngestStats = { vehicles: 0, tripUpdates: 0, alerts: 0 };
  const nowIso = new Date().toISOString();

  // Guard anti-sovrapposizione: se una run precedente è ancora in corso
  // (lock fresco con TTL 120s), esco subito senza toccare i dati.
  const lockRows = await sql`SELECT ingest_rt_try_begin(${120}) AS got_lock`;
  const gotLock = (lockRows[0] as { got_lock: boolean }).got_lock;
  if (!gotLock) {
    console.log("[ingest-rt] già in corso, skip");
    return { ok: true, stats };
  }

  try {
    // ---- Vehicle Positions: upsert per vehicle_id, poi pulizia stale ----------
    const vp = await fetchFeed(FEEDS.vehicles);
    // Dedup per vehicle_id: il feed può riportare lo stesso mezzo due volte,
    // e un upsert con id duplicato fallirebbe ("cannot affect row a second time").
    const vehiclesMap = new Map<string, Record<string, unknown>>();
    for (const e of vp.entity) {
      const v = e.vehicle;
      const lat = v?.position?.latitude, lon = v?.position?.longitude;
      const id = v?.vehicle?.id ?? e.id;
      if (lat == null || lon == null || !id) continue;
      vehiclesMap.set(id, {
        vehicle_id:   id,
        trip_id:      v?.trip?.tripId ?? null,
        route_id:     v?.trip?.routeId ?? null,
        direction_id: toNum(v?.trip?.directionId),
        lat, lon,
        bearing:      v?.position?.bearing ?? null,
        speed:        v?.position?.speed ?? null,
        ts:           tsToIso(toNum(v?.timestamp)) ?? nowIso,
        updated_at:   nowIso,
      });
    }
    const vehicles = [...vehiclesMap.values()];
    if (vehicles.length > 0) {
      for (const c of chunk(vehicles, 1000)) {
        await sql`
          INSERT INTO vehicle_positions ${sql(c)}
          ON CONFLICT (vehicle_id) DO UPDATE SET
            trip_id      = EXCLUDED.trip_id,
            route_id     = EXCLUDED.route_id,
            direction_id = EXCLUDED.direction_id,
            lat          = EXCLUDED.lat,
            lon          = EXCLUDED.lon,
            bearing      = EXCLUDED.bearing,
            speed        = EXCLUDED.speed,
            ts           = EXCLUDED.ts,
            updated_at   = EXCLUDED.updated_at
        `;
      }
    }
    // Pulizia mezzi non aggiornati negli ultimi 5 minuti
    await sql`DELETE FROM vehicle_positions WHERE ts < ${new Date(Date.now() - 5 * 60_000).toISOString()}`;
    stats.vehicles = vehicles.length;

    // ---- Trip Updates: replace completo, solo fermate future ------------------
    const tu = await fetchFeed(FEEDS.trips);
    // Dedup per (trip_id, stop_sequence): il feed può riportare lo stesso
    // viaggio più volte e violerebbe la primary key. Tengo l'ultimo.
    const updatesMap = new Map<string, Record<string, unknown>>();
    const cutoff = Date.now() - 60_000;
    for (const e of tu.entity) {
      const t = e.tripUpdate;
      if (!t?.trip?.tripId) continue;
      if (t.trip.scheduleRelationship === TRIP_CANCELED) continue;
      const directionId = toNum(t.trip.directionId);
      for (const stu of t.stopTimeUpdate ?? []) {
        if (stu.scheduleRelationship === STU_SKIPPED) continue;
        const seq = toNum(stu.stopSequence);
        if (seq == null) continue;
        const arr = tsToIso(toNum(stu.arrival?.time));
        const dep = tsToIso(toNum(stu.departure?.time));
        const eta = arr ?? dep;
        if (!eta) continue;
        if (new Date(eta).getTime() < cutoff) continue;
        updatesMap.set(`${t.trip.tripId}|${seq}`, {
          trip_id:      t.trip.tripId,
          stop_sequence: seq,
          route_id:     t.trip.routeId ?? null,
          stop_id:      stu.stopId ?? null,
          direction_id: directionId,
          arrival_ts:   arr,
          departure_ts: dep,
          delay:        toNum(stu.arrival?.delay) ?? toNum(stu.departure?.delay),
          updated_at:   nowIso,
        });
      }
    }
    const updates = [...updatesMap.values()];
    // Swap ATOMICO lato Postgres: delete+insert in un'unica transazione, così
    // i lettori non vedono mai la tabella vuota (vedi 0009_hardening.sql).
    await sql`SELECT replace_trip_updates(${sql.json(updates)})`;
    stats.tripUpdates = updates.length;

    // ---- Service Alerts: replace completo -------------------------------------
    const al = await fetchFeed(FEEDS.alerts);
    const alertsMap = new Map<string, Record<string, unknown>>();
    for (const e of al.entity) {
      const a = e.alert;
      if (!a) continue;
      const routeIds = new Set<string>();
      const stopIds  = new Set<string>();
      for (const ie of a.informedEntity ?? []) {
        if (ie.routeId) routeIds.add(ie.routeId);
        if (ie.stopId)  stopIds.add(ie.stopId);
      }
      const period = a.activePeriod?.[0];
      alertsMap.set(e.id, {
        id:          e.id,
        header:      a.headerText?.translation?.[0]?.text ?? null,
        description: a.descriptionText?.translation?.[0]?.text ?? null,
        cause:       a.cause != null ? String(a.cause) : null,
        effect:      a.effect != null ? String(a.effect) : null,
        route_ids:   [...routeIds],
        stop_ids:    [...stopIds],
        start_ts:    tsToIso(toNum(period?.start)),
        end_ts:      tsToIso(toNum(period?.end)),
        updated_at:  nowIso,
      });
    }
    const alerts = [...alertsMap.values()];
    await sql`SELECT replace_service_alerts(${sql.json(alerts)})`;
    stats.alerts = alerts.length;

    // ---- feed_meta ------------------------------------------------------------
    const feedMeta = [
      { feed: "vehicles",     last_fetch: nowIso, entity_count: stats.vehicles },
      { feed: "trip_updates", last_fetch: nowIso, entity_count: stats.tripUpdates },
      { feed: "alerts",       last_fetch: nowIso, entity_count: stats.alerts },
    ];
    await sql`
      INSERT INTO feed_meta ${sql(feedMeta, "feed", "last_fetch", "entity_count")}
      ON CONFLICT (feed) DO UPDATE SET
        last_fetch   = EXCLUDED.last_fetch,
        entity_count = EXCLUDED.entity_count
    `;

    return { ok: true, stats };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ingest-rt] errore:", message);
    return { ok: false, error: message };

  } finally {
    // Rilascia sempre il lock (anche in caso di errore): il lock scade
    // comunque per TTL, ma rilasciarlo subito permette alla prossima run di partire.
    try {
      await sql`SELECT ingest_rt_end()`;
    } catch { /* ignora: il lock scade comunque per TTL */ }
  }
}
