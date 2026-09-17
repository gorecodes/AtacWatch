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
 *
 * Ottimizzazione lessicografica su (orario di arrivo, numero di corse). Il
 * solo earliest-arrival non basta: a parità di orario sceglie arbitrariamente,
 * e "arbitrariamente" a volte è assurdo. Il caso che l'ha reso evidente:
 * Colosseo → EUR prendeva la metro verso NORD fino a Cavour, attraversava la
 * banchina e riprendeva quella verso sud, che passa da Colosseo un minuto
 * dopo — stesso orario di arrivo, cinque tratte invece di tre.
 *
 * Il punto di salita si può quindi spostare più a valle sulla stessa corsa se
 * costa meno cambi, ma solo finché quella corsa non ha ancora migliorato
 * nessuna fermata (tripUsed): dopo, spostarlo produrrebbe tratte degeneri in
 * cui si sale e si scende nello stesso punto.
 *
 * Resta un limite: lessicografico non è Pareto, quindi un itinerario che
 * arriva un minuto prima con due cambi in più vince ancora. Il rimedio vero è
 * un'ottimizzazione multi-criterio.
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

  /** Numero di corse usate per raggiungere la fermata: il secondo criterio. */
  const rides = new Int32Array(numStops);

  const tripBoarded = new Uint8Array(cs.tripSourceId.length);
  const boardConn = new Int32Array(cs.tripSourceId.length).fill(-1);
  const tripRides = new Int32Array(cs.tripSourceId.length);
  /** La corsa ha già migliorato una fermata: spostarne la salita non è più sicuro. */
  const tripUsed = new Uint8Array(cs.tripSourceId.length);

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
      rides[a.stop] = 0;
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
    const ds = cs.depStop[i];
    const salibile = earliest[ds] + MIN_TRANSFER_S <= dep;
    const candidato = rides[ds] + 1;

    if (tripBoarded[trip] === 0) {
      if (!salibile) continue;
      tripBoarded[trip] = 1;
      boardConn[trip] = i;
      tripRides[trip] = candidato;
    } else if (salibile && tripUsed[trip] === 0 && candidato < tripRides[trip]) {
      // Salire più a valle sulla stessa corsa costa meno cambi: è il caso
      // "vado a nord una fermata per riprendere la stessa linea a sud".
      boardConn[trip] = i;
      tripRides[trip] = candidato;
    }

    const arr = cs.arrTime[i];
    const as = cs.arrStop[i];
    // A parità di orario vince chi ha usato meno corse.
    if (arr > earliest[as]) continue;
    if (arr === earliest[as] && tripRides[trip] >= rides[as]) continue;

    earliest[as] = arr;
    arrivedBy[as] = i;
    walkedFrom[as] = -1;
    rides[as] = tripRides[trip];
    tripUsed[trip] = 1;
    if (egressSecs[as] >= 0 && arr + egressSecs[as] < best) {
      best = arr + egressSecs[as];
      bestStop = as;
    }

    for (let k = fp.offset[as]; k < fp.offset[as + 1]; k++) {
      const to = fp.target[k];
      const t = arr + fp.seconds[k];
      if (t > earliest[to]) continue;
      if (t === earliest[to] && rides[as] >= rides[to]) continue;
      earliest[to] = t;
      arrivedBy[to] = -1;
      walkedFrom[to] = as;
      walkSecs[to] = fp.seconds[k];
      rides[to] = rides[as];
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
