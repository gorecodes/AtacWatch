// Edge Function "ingest-rt" — polling dei feed GTFS-RT di Roma (ogni ~60s).
// Scarica i 3 .pb, decodifica il protobuf, fa upsert nelle tabelle realtime.
// Invocata da pg_cron (vedi migration 0004_realtime_cron.sql).
//
// Deploy:  supabase functions deploy ingest-rt
//
// Variabili iniettate automaticamente da Supabase:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// gtfs-realtime-bindings è CommonJS: esm.sh lo espone come default export,
// quindi prendiamo transit_realtime dall'oggetto default (no named export).
import GtfsRealtimeBindings from "https://esm.sh/gtfs-realtime-bindings@1.1.1";

const { transit_realtime } = GtfsRealtimeBindings;

// Valori scheduleRelationship (GTFS-RT). Usiamo i numeri grezzi invece degli
// enum annidati del binding: protobuf.js decodifica gli enum come numeri, e
// così non dipendiamo dalla struttura interna del pacchetto (che cambia tra
// versioni e su esm.sh può non esporre le namespace annidate al top-level).
const TRIP_CANCELED = 3; // TripDescriptor.ScheduleRelationship.CANCELED
const STU_SKIPPED = 1; // StopTimeUpdate.ScheduleRelationship.SKIPPED
// NB: NO_DATA (2) NON va scartata: significa "niente predizione realtime per
// questa fermata", non "fermata da saltare". Roma marca così i CAPOLINEA, che
// però portano comunque l'orario: scartandoli si perdeva l'ultima fermata
// della corsa (il dettaglio mostrava una fermata intermedia come destinazione).

const BASE = "https://romamobilita.it/sites/default/files";
const FEEDS = {
  vehicles: `${BASE}/rome_rtgtfs_vehicle_positions_feed.pb`,
  trips: `${BASE}/rome_rtgtfs_trip_updates_feed.pb`,
  alerts: `${BASE}/rome_rtgtfs_service_alerts_feed.pb`,
};

// 64-bit protobuf (Long) o number -> number | null
// deno-lint-ignore no-explicit-any
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

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const stats: Record<string, number> = {};
  const nowIso = new Date().toISOString();

  // Guard anti-sovrapposizione: se una run precedente è ancora in corso
  // (lock fresco), esco subito senza toccare i dati.
  const { data: gotLock, error: lockErr } = await supabase.rpc("ingest_rt_try_begin", {
    p_ttl_seconds: 120,
  });
  if (lockErr) throw new Error(`ingest_rt_try_begin: ${lockErr.message}`);
  if (!gotLock) {
    return new Response(JSON.stringify({ ok: true, skipped: "already running" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // ---- Vehicle Positions: upsert per vehicle_id, poi pulizia stale --------
    const vp = await fetchFeed(FEEDS.vehicles);
    // Dedup per vehicle_id: il feed può riportare lo stesso mezzo due volte,
    // e un upsert con id duplicato fallisce ("cannot affect row a second time").
    const vehiclesMap = new Map<string, Record<string, unknown>>();
    for (const e of vp.entity) {
      const v = e.vehicle;
      const lat = v?.position?.latitude, lon = v?.position?.longitude;
      const id = v?.vehicle?.id ?? e.id;
      if (lat == null || lon == null || !id) continue;
      vehiclesMap.set(id, {
        vehicle_id: id,
        trip_id: v?.trip?.tripId ?? null,
        route_id: v?.trip?.routeId ?? null,
        direction_id: toNum(v?.trip?.directionId),
        lat, lon,
        bearing: v?.position?.bearing ?? null,
        speed: v?.position?.speed ?? null,
        ts: tsToIso(toNum(v?.timestamp)) ?? nowIso,
        updated_at: nowIso,
      });
    }
    const vehicles = [...vehiclesMap.values()];
    for (const c of chunk(vehicles, 1000)) {
      const { error } = await supabase.from("vehicle_positions").upsert(c, { onConflict: "vehicle_id" });
      if (error) throw new Error(`upsert vehicle_positions: ${error.message}`);
    }
    await supabase.from("vehicle_positions").delete().lt("ts", new Date(Date.now() - 5 * 60_000).toISOString());
    stats.vehicles = vehicles.length;

    // ---- Trip Updates: replace completo, solo fermate future -----------------
    const tu = await fetchFeed(FEEDS.trips);
    // Dedup per (trip_id, stop_sequence): il feed può riportare lo stesso
    // viaggio più volte e violerebbe la primary key. Tengo l'ultimo.
    const updatesMap = new Map<string, Record<string, unknown>>();
    const cutoff = Date.now() - 60_000;
    for (const e of tu.entity) {
      const t = e.tripUpdate;
      if (!t?.trip?.tripId) continue;
      // Corsa cancellata: niente arrivi realtime per questo trip.
      if (t.trip.scheduleRelationship === TRIP_CANCELED) continue;
      const directionId = toNum(t.trip.directionId);
      for (const stu of t.stopTimeUpdate ?? []) {
        // Solo le fermate SKIPPED (il bus non ferma davvero) vanno saltate.
        // NO_DATA si tiene: è il caso tipico dei capolinea, che portano l'orario.
        if (stu.scheduleRelationship === STU_SKIPPED) continue;
        const seq = toNum(stu.stopSequence);
        if (seq == null) continue;
        const arr = tsToIso(toNum(stu.arrival?.time));
        const dep = tsToIso(toNum(stu.departure?.time));
        const eta = arr ?? dep;
        // Senza un orario assoluto la riga è inutile (resta solo il delay): skip.
        if (!eta) continue;
        if (new Date(eta).getTime() < cutoff) continue;
        updatesMap.set(`${t.trip.tripId}|${seq}`, {
          trip_id: t.trip.tripId,
          stop_sequence: seq,
          route_id: t.trip.routeId ?? null,
          stop_id: stu.stopId ?? null,
          direction_id: directionId,
          arrival_ts: arr,
          departure_ts: dep,
          delay: toNum(stu.arrival?.delay) ?? toNum(stu.departure?.delay),
          updated_at: nowIso,
        });
      }
    }
    const updates = [...updatesMap.values()];
    // Swap ATOMICO lato Postgres: delete+insert in un'unica transazione, così
    // i lettori non vedono mai la tabella vuota (vedi 0009_hardening.sql).
    {
      const { error } = await supabase.rpc("replace_trip_updates", { p_rows: updates });
      if (error) throw new Error(`replace_trip_updates: ${error.message}`);
    }
    stats.tripUpdates = updates.length;

    // ---- Service Alerts: replace completo ------------------------------------
    const al = await fetchFeed(FEEDS.alerts);
    const alertsMap = new Map<string, Record<string, unknown>>();
    for (const e of al.entity) {
      const a = e.alert;
      if (!a) continue;
      const routeIds = new Set<string>();
      const stopIds = new Set<string>();
      for (const ie of a.informedEntity ?? []) {
        if (ie.routeId) routeIds.add(ie.routeId);
        if (ie.stopId) stopIds.add(ie.stopId);
      }
      const period = a.activePeriod?.[0];
      alertsMap.set(e.id, {
        id: e.id,
        header: a.headerText?.translation?.[0]?.text ?? null,
        description: a.descriptionText?.translation?.[0]?.text ?? null,
        cause: a.cause != null ? String(a.cause) : null,
        effect: a.effect != null ? String(a.effect) : null,
        route_ids: [...routeIds],
        stop_ids: [...stopIds],
        start_ts: tsToIso(toNum(period?.start)),
        end_ts: tsToIso(toNum(period?.end)),
        updated_at: nowIso,
      });
    }
    const alerts = [...alertsMap.values()];
    {
      const { error } = await supabase.rpc("replace_service_alerts", { p_rows: alerts });
      if (error) throw new Error(`replace_service_alerts: ${error.message}`);
    }
    stats.alerts = alerts.length;

    // ---- feed_meta -----------------------------------------------------------
    await supabase.from("feed_meta").upsert([
      { feed: "vehicles", last_fetch: nowIso, entity_count: stats.vehicles },
      { feed: "trip_updates", last_fetch: nowIso, entity_count: stats.tripUpdates },
      { feed: "alerts", last_fetch: nowIso, entity_count: stats.alerts },
    ], { onConflict: "feed" });

    return new Response(JSON.stringify({ ok: true, stats }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ingest-rt error", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    // Rilascia sempre il lock (anche in caso di errore), così la prossima run
    // parte. .rpc() ritorna un builder thenable SENZA .catch, quindi niente
    // .catch(): si avvolge in try/catch per ignorare eventuali errori qui.
    try {
      await supabase.rpc("ingest_rt_end");
    } catch { /* ignora: il lock scade comunque per TTL */ }
  }
});
