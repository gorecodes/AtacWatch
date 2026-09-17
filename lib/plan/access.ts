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
 * LIMITE NOTO. L'algoritmo minimizza l'ora di arrivo e ignora la fatica,
 * quindi può proporre dieci minuti a piedi per guadagnarne due. La correzione
 * vera è un'ottimizzazione multi-criterio (Pareto su orario e cammino), fuori
 * dalla v1: per ora il raggio fa da limite e il numero di fermate è limitato.
 */
import type postgres from "postgres";
import type { ConnectionSet } from "./connections";
import { ACCESS_RADIUS_M, walkSeconds } from "./policy";

export type AccessStop = {
  stop: number;
  seconds: number;
  stopId: string;
  name: string;
  meters: number;
};

/** Oltre questo numero le fermate in più sono sempre le più lontane e inutili. */
const MAX_ACCESS_STOPS = 40;

export async function findAccess(
  sql: postgres.Sql,
  cs: ConnectionSet,
  lat: number,
  lon: number,
  radiusM: number = ACCESS_RADIUS_M,
): Promise<AccessStop[]> {
  // st_dwithin in gradi sfrutta l'indice GiST su geom; il divisore 82000 è
  // basato sul grado di longitudine alla latitudine di Roma (il più corto dei
  // due), quindi il prefiltro è generoso e non perde fermate.
  const rows = await sql<{ stop_id: string; name: string; meters: number }[]>`
    WITH p AS (
      SELECT st_setsrid(st_makepoint(${lon}, ${lat}), 4326) AS g
    )
    SELECT s.stop_id, s.name,
           round(st_distance(s.geom::geography, p.g::geography))::int AS meters
    FROM stops s, p
    WHERE st_dwithin(s.geom, p.g, ${radiusM} / 82000.0)
      AND st_distance(s.geom::geography, p.g::geography) <= ${radiusM}
    ORDER BY meters
    LIMIT ${MAX_ACCESS_STOPS}
  `;

  const out: AccessStop[] = [];
  for (const r of rows) {
    const stop = cs.stopIndex.get(r.stop_id);
    // Fermata senza servizio nei giorni caricati: non ha indice, e non serve.
    if (stop === undefined) continue;
    out.push({
      stop,
      seconds: walkSeconds(r.meters),
      stopId: r.stop_id,
      name: r.name,
      meters: r.meters,
    });
  }
  return out;
}

/** Distanza a piedi in linea d'aria tra due punti, per il caso "ci arrivo a piedi". */
export async function walkDistance(
  sql: postgres.Sql,
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): Promise<number> {
  const r = await sql<{ meters: number }[]>`
    SELECT round(st_distance(
      st_setsrid(st_makepoint(${fromLon}, ${fromLat}), 4326)::geography,
      st_setsrid(st_makepoint(${toLon}, ${toLat}), 4326)::geography
    ))::int AS meters
  `;
  return r[0].meters;
}
