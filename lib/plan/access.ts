/**
 * Fermate raggiungibili a piedi da un punto qualsiasi.
 *
 * Serve ai due capi del viaggio: dall'indirizzo di partenza alla prima
 * fermata, e dall'ultima fermata all'indirizzo di destinazione. È il tratto
 * "scendo e faccio 600 metri per arrivare alla via".
 *
 * A differenza dei trasferimenti tra fermate (0019_transfers.sql), qui il
 * raggio può essere generoso: è una singola ricerca spaziale per richiesta e
 * non un prodotto cartesiano precalcolato, quindi allargarlo non moltiplica
 * niente.
 *
 * Le distanze sono quelle STRADALI, chieste a OSRM: la linea d'aria non
 * sbagliava solo il numero mostrato ma gli itinerari. Su SALARIA/CASTEL
 * GIUBILEO dava 396 metri dove la strada reale è 4475, cioè sei minuti invece
 * di 56, e il router presentava come migliore un percorso impossibile.
 * PostGIS fa da prefiltro: la distanza reale non è mai inferiore alla linea
 * d'aria, quindi selezionare per raggio e poi raffinare non perde nessuna
 * fermata.
 */
import type postgres from "postgres";
import type { ConnectionSet } from "./connections";
import { ACCESS_RADIUS_M, walkSeconds } from "./policy";
import { distanzeDaPunto, distanzaTraPunti } from "./walking";

export type AccessStop = {
  stop: number;
  seconds: number;
  stopId: string;
  name: string;
  /** Metri di strada reale, o in linea d'aria se OSRM non ha risposto. */
  meters: number;
  /** false quando è stato necessario ripiegare sull'approssimazione. */
  reale: boolean;
};

/** Oltre questo numero le fermate in più sono sempre le più lontane e inutili. */
const MAX_ACCESS_STOPS = 40;

export async function findAccess(
  sql: postgres.Sql,
  cs: ConnectionSet,
  lat: number,
  lon: number,
  radiusM: number = ACCESS_RADIUS_M,
  verso: "andata" | "ritorno" = "andata",
): Promise<AccessStop[]> {
  // st_dwithin in gradi sfrutta l'indice GiST su geom; il divisore 82000 è
  // basato sul grado di longitudine alla latitudine di Roma (il più corto dei
  // due), quindi il prefiltro è generoso e non perde fermate.
  const rows = await sql<{ stop_id: string; name: string; meters: number; lat: number; lon: number }[]>`
    WITH p AS (
      SELECT st_setsrid(st_makepoint(${lon}, ${lat}), 4326) AS g
    )
    SELECT s.stop_id, s.name,
           round(st_distance(s.geom::geography, p.g::geography))::int AS meters,
           st_y(s.geom)::float8 AS lat, st_x(s.geom)::float8 AS lon
    FROM stops s, p
    WHERE st_dwithin(s.geom, p.g, ${radiusM} / 82000.0)
      AND st_distance(s.geom::geography, p.g::geography) <= ${radiusM}
    ORDER BY meters
    LIMIT ${MAX_ACCESS_STOPS}
  `;

  // Solo le fermate con servizio nei giorni caricati: le altre non hanno
  // indice nel set di connessioni e non servirebbero a niente.
  const candidate = rows.filter((r) => cs.stopIndex.get(r.stop_id) !== undefined);
  if (candidate.length === 0) return [];

  const reali = await distanzeDaPunto(
    lat,
    lon,
    candidate.map((r) => ({ lat: r.lat, lon: r.lon, metriLineaAria: r.meters })),
    verso,
  );

  const tutte: AccessStop[] = candidate.map((r, i) => ({
    stop: cs.stopIndex.get(r.stop_id)!,
    seconds: reali[i].reale ? reali[i].seconds : walkSeconds(r.meters),
    stopId: r.stop_id,
    name: r.name,
    meters: reali[i].meters,
    reale: reali[i].reale,
  }));

  // Il raggio si applica di nuovo sulla distanza REALE: è qui che cadono le
  // fermate vicine in linea d'aria ma inarrivabili a piedi, che sono la causa
  // degli itinerari impossibili.
  const dentro = tutte.filter((a) => a.meters <= radiusM);

  // Se nessuna sopravvive si tiene la più vicina davvero: meglio un itinerario
  // con una lunga camminata dichiarata che nessun itinerario.
  if (dentro.length === 0) {
    return [tutte.reduce((m, a) => (a.meters < m.meters ? a : m))];
  }
  return dentro.sort((a, b) => a.meters - b.meters);
}

/** Distanza a piedi tra due punti, per il caso "ci arrivo a piedi". */
export async function walkDistance(
  sql: postgres.Sql,
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): Promise<{ meters: number; seconds: number }> {
  const r = await sql<{ meters: number }[]>`
    SELECT round(st_distance(
      st_setsrid(st_makepoint(${fromLon}, ${fromLat}), 4326)::geography,
      st_setsrid(st_makepoint(${toLon}, ${toLat}), 4326)::geography
    ))::int AS meters
  `;
  const c = await distanzaTraPunti(fromLat, fromLon, toLat, toLon, r[0].meters);
  return { meters: c.meters, seconds: c.seconds };
}
