/**
 * Trasferimenti a piedi in formato CSR, indicizzati come le connessioni.
 *
 * Il CSA, ogni volta che migliora l'arrivo a una fermata, deve scorrere tutte
 * le fermate raggiungibili a piedi da quella. Con una mediana di 15
 * trasferimenti per fermata succede milioni di volte, quindi serve un accesso
 * senza allocazioni: tre array tipizzati invece di una mappa di liste.
 */
import type postgres from "postgres";
import type { ConnectionSet } from "./connections";
import { MAX_TRANSFER_M, walkSeconds } from "./policy";

export type Footpaths = {
  /** offset[s] .. offset[s+1] delimitano i trasferimenti dalla fermata s */
  offset: Int32Array;
  target: Int32Array;
  seconds: Int32Array;
  n: number;
};

const CACHE = new Map<string, Promise<Footpaths>>();

export function loadFootpaths(
  sql: postgres.Sql,
  cs: ConnectionSet,
  dateISO: string,
  maxMeters: number = MAX_TRANSFER_M,
): Promise<Footpaths> {
  const key = `${dateISO}|${maxMeters}`;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const p = build(sql, cs, maxMeters);
  CACHE.set(key, p);
  p.catch(() => CACHE.delete(key));
  return p;
}

export function clearFootpathCache() {
  CACHE.clear();
}

async function build(sql: postgres.Sql, cs: ConnectionSet, maxMeters: number): Promise<Footpaths> {
  const numStops = cs.stopIds.length;

  const rows = await sql<{ from_stop_id: string; to_stop_id: string; meters: number }[]>`
    SELECT from_stop_id, to_stop_id, meters
    FROM transfers
    WHERE meters <= ${maxMeters}
  `;

  // Prima passata: conta i trasferimenti per fermata di partenza. Si scartano
  // le coppie che toccano fermate senza servizio nei giorni caricati, perché
  // non hanno un indice nel set di connessioni.
  const counts = new Int32Array(numStops);
  const kept: { f: number; t: number; m: number }[] = [];
  for (const r of rows) {
    const f = cs.stopIndex.get(r.from_stop_id);
    const t = cs.stopIndex.get(r.to_stop_id);
    if (f === undefined || t === undefined) continue;
    counts[f]++;
    kept.push({ f, t, m: r.meters });
  }

  const offset = new Int32Array(numStops + 1);
  for (let s = 0; s < numStops; s++) offset[s + 1] = offset[s] + counts[s];

  const n = kept.length;
  const target = new Int32Array(n);
  const seconds = new Int32Array(n);
  const cursor = offset.slice(0, numStops);
  for (const k of kept) {
    const pos = cursor[k.f]++;
    target[pos] = k.t;
    seconds[pos] = walkSeconds(k.m);
  }

  return { offset, target, seconds, n };
}
