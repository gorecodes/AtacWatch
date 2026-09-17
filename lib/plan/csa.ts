/**
 * Connection Scan Algorithm: arrivo più presto possibile.
 *
 * Si scorre una volta sola l'array delle connessioni ordinato per ora di
 * partenza, tenendo per ogni fermata l'arrivo più presto noto. È stato scelto
 * al posto di un Dijkstra su grafo tempo-espanso per un motivo preciso: il
 * tentativo precedente di questa feature è fallito sulla correttezza, e una
 * scansione lineare è difficilissima da sbagliare.
 *
 * Tre punti che rompono queste implementazioni, gestiti qui esplicitamente:
 *
 * 1. Una volta a bordo si resta a bordo. Senza il flag per corsa, l'algoritmo
 *    pretende di poter risalire a ogni fermata e trova solo viaggi di una
 *    tratta.
 * 2. La ricostruzione risale al PUNTO DI SALITA della corsa, non alla fermata
 *    precedente. L'arrivo migliore alla fermata precedente può provenire da un
 *    percorso completamente diverso da quello con cui ci siamo saliti.
 * 3. Salire richiede un margine (MIN_TRANSFER_S), altrimenti si producono
 *    coincidenze al secondo che nella realtà si perdono.
 */
import type { ConnectionSet } from "./connections";
import type { Footpaths } from "./footpaths";
import { MIN_TRANSFER_S, MAX_LEGS } from "./policy";

const INF = 0x7fffffff;

/** Fermata raggiungibile a piedi dall'origine (o che raggiunge la destinazione). */
export type Access = { stop: number; seconds: number };

export type Leg =
  | {
      kind: "ride";
      tripIdx: number;
      fromStop: number;
      toStop: number;
      /** secondi da ConnectionSet.baseEpoch */
      departAt: number;
      arriveAt: number;
    }
  | {
      kind: "walk";
      /** null = l'origine o la destinazione, non una fermata */
      fromStop: number | null;
      toStop: number | null;
      seconds: number;
      departAt: number;
      arriveAt: number;
    };

export type CsaResult = {
  legs: Leg[];
  /** secondi da ConnectionSet.baseEpoch */
  departAt: number;
  arriveAt: number;
  scanned: number;
};

/** Prima connessione con depTime >= t, su array ordinato. */
function lowerBound(depTime: Int32Array, n: number, t: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (depTime[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function csaEarliestArrival(
  cs: ConnectionSet,
  fp: Footpaths,
  access: Access[],
  egress: Access[],
  departEpoch: number,
): CsaResult | null {
  const numStops = cs.stopIds.length;
  const t0 = departEpoch - cs.baseEpoch;

  const earliest = new Int32Array(numStops).fill(INF);
  const arrivedBy = new Int32Array(numStops).fill(-1);
  const walkedFrom = new Int32Array(numStops).fill(-1);
  const walkSecs = new Int32Array(numStops);

  const tripBoarded = new Uint8Array(cs.tripSourceId.length);
  const boardConn = new Int32Array(cs.tripSourceId.length).fill(-1);

  // -1 = non è un'uscita; altrimenti secondi a piedi fino a destinazione.
  const egressSecs = new Int32Array(numStops).fill(-1);
  for (const e of egress) {
    if (egressSecs[e.stop] < 0 || e.seconds < egressSecs[e.stop]) egressSecs[e.stop] = e.seconds;
  }

  let best = INF;
  let bestStop = -1;

  for (const a of access) {
    const t = t0 + a.seconds;
    if (t < earliest[a.stop]) {
      earliest[a.stop] = t;
      arrivedBy[a.stop] = -1;
      walkedFrom[a.stop] = -1; // -1 con arrivedBy -1 significa "dall'origine"
      walkSecs[a.stop] = a.seconds;
      if (egressSecs[a.stop] >= 0 && t + egressSecs[a.stop] < best) {
        best = t + egressSecs[a.stop];
        bestStop = a.stop;
      }
    }
  }

  let scanned = 0;
  for (let i = lowerBound(cs.depTime, cs.n, t0); i < cs.n; i++) {
    const dep = cs.depTime[i];
    // Una connessione che parte dopo il miglior arrivo noto non può migliorarlo,
    // e tutte le successive partono ancora più tardi.
    if (dep >= best) break;
    scanned++;

    const trip = cs.tripIdx[i];
    if (tripBoarded[trip] === 0) {
      if (earliest[cs.depStop[i]] + MIN_TRANSFER_S > dep) continue;
      tripBoarded[trip] = 1;
      boardConn[trip] = i;
    }

    const arr = cs.arrTime[i];
    const as = cs.arrStop[i];
    if (arr >= earliest[as]) continue;

    earliest[as] = arr;
    arrivedBy[as] = i;
    walkedFrom[as] = -1;
    if (egressSecs[as] >= 0 && arr + egressSecs[as] < best) {
      best = arr + egressSecs[as];
      bestStop = as;
    }

    for (let k = fp.offset[as]; k < fp.offset[as + 1]; k++) {
      const to = fp.target[k];
      const t = arr + fp.seconds[k];
      if (t >= earliest[to]) continue;
      earliest[to] = t;
      arrivedBy[to] = -1;
      walkedFrom[to] = as;
      walkSecs[to] = fp.seconds[k];
      if (egressSecs[to] >= 0 && t + egressSecs[to] < best) {
        best = t + egressSecs[to];
        bestStop = to;
      }
    }
  }

  if (bestStop < 0) return null;

  const legs: Leg[] = [];
  let s = bestStop;

  // L'ultimo tratto a piedi, dalla fermata alla destinazione.
  if (egressSecs[s] > 0) {
    legs.push({
      kind: "walk",
      fromStop: s,
      toStop: null,
      seconds: egressSecs[s],
      departAt: earliest[s],
      arriveAt: earliest[s] + egressSecs[s],
    });
  }

  for (let guard = 0; guard <= MAX_LEGS * 2 + 2; guard++) {
    const conn = arrivedBy[s];

    if (conn >= 0) {
      const trip = cs.tripIdx[conn];
      const board = boardConn[trip];
      legs.push({
        kind: "ride",
        tripIdx: trip,
        fromStop: cs.depStop[board],
        toStop: s,
        departAt: cs.depTime[board],
        arriveAt: cs.arrTime[conn],
      });
      s = cs.depStop[board];
      continue;
    }

    const from = walkedFrom[s];
    if (from >= 0) {
      legs.push({
        kind: "walk",
        fromStop: from,
        toStop: s,
        seconds: walkSecs[s],
        departAt: earliest[s] - walkSecs[s],
        arriveAt: earliest[s],
      });
      s = from;
      continue;
    }

    // Raggiunta a piedi dall'origine: è l'inizio del viaggio.
    if (walkSecs[s] > 0) {
      legs.push({
        kind: "walk",
        fromStop: null,
        toStop: s,
        seconds: walkSecs[s],
        departAt: earliest[s] - walkSecs[s],
        arriveAt: earliest[s],
      });
    }
    break;
  }

  legs.reverse();
  if (legs.length === 0) return null;

  return {
    legs,
    departAt: legs[0].departAt,
    arriveAt: best,
    scanned,
  };
}
