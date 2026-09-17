/**
 * Caricatore delle connessioni per il calcolo percorsi (CSA).
 *
 * Una "connessione" è la tratta elementare di una corsa tra due fermate
 * consecutive: parti da A alle 8:03, arrivi a B alle 8:06. Il Connection Scan
 * Algorithm lavora su questo array ordinato per ora di partenza, e lo scorre
 * una volta sola.
 *
 * Perché tre giorni di servizio. Gli orari GTFS possono superare le 24 ore:
 * una corsa dell'1:30 appartiene al giorno di servizio precedente con
 * departure_s = 91800. Chi interroga alle 00:30 ha bisogno delle corse di
 * ieri, chi interroga alle 23:50 di quelle di domani mattina. Caricando
 * ieri/oggi/domani e convertendo tutto in istanti assoluti, il problema
 * sparisce e l'algoritmo non deve saperne niente.
 *
 * Sosta zero: il feed di Roma ha un solo orario per fermata (vedi
 * 0018_timetable.sql), quindi l'arrivo a B coincide con la sua partenza. Sui
 * bus la sosta è di pochi secondi.
 *
 * I nomi di linea e le testate NON stanno qui: servono solo a mostrare il
 * risultato, e l'itinerario finale contiene due o tre corse. Tenerli fuori
 * evita di trascinare 170.000 righe di anagrafica nel percorso caldo.
 */
import type postgres from "postgres";

export type ConnectionSet = {
  /** Istante (epoch secondi) della mezzanotte del primo giorno caricato. */
  baseEpoch: number;
  n: number;
  /** Tutti i tempi sono secondi da baseEpoch, così stanno in Int32. */
  depStop: Int32Array;
  arrStop: Int32Array;
  depTime: Int32Array;
  arrTime: Int32Array;
  tripIdx: Int32Array;
  /** indice → stop_id e inverso */
  stopIds: string[];
  stopIndex: Map<string, number>;
  /** indice di corsa → trip_id del feed (una corsa che viaggia due giorni ha due indici) */
  tripSourceId: string[];
  /** connessioni scartate perché con tempo non crescente (dati sporchi) */
  skipped: number;
};

/** Array Int32 a crescita per raddoppio: la lunghezza non è nota in anticipo. */
class I32 {
  private buf: Int32Array;
  len = 0;
  constructor(cap = 1 << 20) {
    this.buf = new Int32Array(cap);
  }
  push(v: number) {
    if (this.len === this.buf.length) {
      const next = new Int32Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = v;
  }
  get(i: number) {
    return this.buf[i];
  }
}

const CACHE = new Map<string, Promise<ConnectionSet>>();

/** Connessioni per la data indicata (YYYY-MM-DD), con cache in memoria. */
export function loadConnections(sql: postgres.Sql, dateISO: string): Promise<ConnectionSet> {
  const hit = CACHE.get(dateISO);
  if (hit) return hit;
  const p = build(sql, dateISO);
  CACHE.set(dateISO, p);
  // Un caricamento fallito non va memorizzato, altrimenti resta rotto per sempre.
  p.catch(() => CACHE.delete(dateISO));
  return p;
}

export function clearConnectionCache() {
  CACHE.clear();
}

async function build(sql: postgres.Sql, dateISO: string): Promise<ConnectionSet> {
  // Le date e le mezzanotti locali le calcola Postgres: fa i conti con l'ora
  // legale correttamente, cosa che in JS richiederebbe una libreria.
  const giorni = await sql<{ giorno: string; base: string }[]>`
    SELECT d::text AS giorno,
           extract(epoch from (d + time '00:00') AT TIME ZONE 'Europe/Rome')::bigint::text AS base
    FROM unnest(ARRAY[${dateISO}::date - 1, ${dateISO}::date, ${dateISO}::date + 1]) AS d
    ORDER BY d
  `;

  const baseEpoch = Number(giorni[0].base);

  const depStop = new I32();
  const arrStop = new I32();
  const depTime = new I32();
  const arrTime = new I32();
  const tripIdx = new I32();

  const stopIds: string[] = [];
  const stopIndex = new Map<string, number>();
  const tripSourceId: string[] = [];
  let skipped = 0;

  const stopOf = (id: string): number => {
    const found = stopIndex.get(id);
    if (found !== undefined) return found;
    const idx = stopIds.length;
    stopIds.push(id);
    stopIndex.set(id, idx);
    return idx;
  };

  for (const g of giorni) {
    // Offset del giorno rispetto a baseEpoch: somma agli orari GTFS per
    // ottenere istanti confrontabili tra giorni diversi.
    const offset = Number(g.base) - baseEpoch;

    let prevTrip: string | null = null;
    let prevStop = -1;
    let prevTime = -1;
    let curTripIdx = -1;

    // La primary key di timetable è (trip_id, stop_sequence), quindi questo
    // ORDER BY è servito da un index scan: le righe arrivano già raggruppate
    // per corsa senza alcun sort (verificato con EXPLAIN).
    const cursor = sql<{ trip_id: string; stop_id: string; departure_s: number }[]>`
      SELECT tt.trip_id, tt.stop_id, tt.departure_s
      FROM timetable tt
      JOIN trips t ON t.trip_id = tt.trip_id
      WHERE t.service_id IN (
        SELECT service_id FROM calendar_dates
        WHERE date = ${g.giorno}::date AND exception_type = 1
      )
      ORDER BY tt.trip_id, tt.stop_sequence
    `.cursor(20_000);

    for await (const rows of cursor) {
      for (const r of rows) {
        const t = r.departure_s + offset;
        if (r.trip_id !== prevTrip) {
          // Nuova corsa: nessuna connessione da chiudere, apre solo la serie.
          prevTrip = r.trip_id;
          curTripIdx = tripSourceId.length;
          tripSourceId.push(r.trip_id);
        } else if (t >= prevTime) {
          // Il confronto è >= e non >: il feed ha risoluzione al minuto, quindi
          // due fermate vicine condividono lo stesso orario. Scartare quelle
          // tratte spezzerebbe la catena della corsa, rendendola non
          // percorribile in quel punto. Una tratta di durata zero è
          // leggermente irreale ma innocua per l'earliest-arrival.
          depStop.push(prevStop);
          arrStop.push(stopOf(r.stop_id));
          depTime.push(prevTime);
          arrTime.push(t);
          tripIdx.push(curTripIdx);
        } else {
          // Orario che torna indietro: dato sporco. Tenerlo romperebbe la
          // monotonia su cui si appoggia la scansione.
          skipped++;
        }
        prevStop = stopOf(r.stop_id);
        prevTime = t;
      }
    }
  }

  return sortByDeparture({
    baseEpoch,
    n: depTime.len,
    depStop,
    arrStop,
    depTime,
    arrTime,
    tripIdx,
    stopIds,
    stopIndex,
    tripSourceId,
    skipped,
  });
}

/**
 * Ordina per ora di partenza con un counting sort. Gli orari sono interi
 * piccoli e contigui (l'arco di tre giorni sta in ~270.000 valori), quindi il
 * conteggio è lineare: un sort con comparatore su qualche milione di elementi
 * costerebbe secondi.
 */
function sortByDeparture(raw: {
  baseEpoch: number;
  n: number;
  depStop: I32;
  arrStop: I32;
  depTime: I32;
  arrTime: I32;
  tripIdx: I32;
  stopIds: string[];
  stopIndex: Map<string, number>;
  tripSourceId: string[];
  skipped: number;
}): ConnectionSet {
  const { n } = raw;

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const t = raw.depTime.get(i);
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (n === 0) {
    min = 0;
    max = 0;
  }

  const counts = new Int32Array(max - min + 2);
  for (let i = 0; i < n; i++) counts[raw.depTime.get(i) - min + 1]++;
  for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];

  const depStop = new Int32Array(n);
  const arrStop = new Int32Array(n);
  const depTime = new Int32Array(n);
  const arrTime = new Int32Array(n);
  const tripIdx = new Int32Array(n);

  for (let i = 0; i < n; i++) {
    const t = raw.depTime.get(i);
    const pos = counts[t - min]++;
    depStop[pos] = raw.depStop.get(i);
    arrStop[pos] = raw.arrStop.get(i);
    depTime[pos] = t;
    arrTime[pos] = raw.arrTime.get(i);
    tripIdx[pos] = raw.tripIdx.get(i);
  }

  return {
    baseEpoch: raw.baseEpoch,
    n,
    depStop,
    arrStop,
    depTime,
    arrTime,
    tripIdx,
    stopIds: raw.stopIds,
    stopIndex: raw.stopIndex,
    tripSourceId: raw.tripSourceId,
    skipped: raw.skipped,
  };
}
