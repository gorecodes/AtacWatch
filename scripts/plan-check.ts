/**
 * Verifica del calcolo percorsi contro il timetable interrogato direttamente.
 *
 * È il controllo che mancava al tentativo precedente: un itinerario può essere
 * plausibile e sbagliato, quindi gli orari restituiti vanno confrontati con
 * quelli in banca dati invece che guardati a occhio.
 *
 * Uso (il DB è esposto su 127.0.0.1 dall'override locale):
 *   DATABASE_URL=postgres://atacwatch:PASSWORD@127.0.0.1:5432/atacwatch \
 *     npx tsx scripts/plan-check.ts
 */
import postgres from "postgres";
import { loadConnections, type ConnectionSet } from "../lib/plan/connections";
import { loadFootpaths } from "../lib/plan/footpaths";
import { csaEarliestArrival } from "../lib/plan/csa";
import { findAccess } from "../lib/plan/access";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL mancante");
  process.exit(1);
}

const sql = postgres(url, { ssl: false, max: 4 });

function hhmm(secondsFromBase: number, baseEpoch: number): string {
  return new Date((baseEpoch + secondsFromBase) * 1000).toLocaleString("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function main() {
  const oggi = new Date().toISOString().slice(0, 10);

  console.log(`\n── Caricamento connessioni per ${oggi} ──`);
  const t0 = Date.now();
  const cs = await loadConnections(sql, oggi);
  const caricamento = Date.now() - t0;

  console.log(`connessioni:      ${cs.n.toLocaleString("it-IT")}`);
  console.log(`fermate distinte: ${cs.stopIds.length.toLocaleString("it-IT")}`);
  console.log(`corse (3 giorni): ${cs.tripSourceId.length.toLocaleString("it-IT")}`);
  console.log(`scartate:         ${cs.skipped.toLocaleString("it-IT")}`);
  console.log(`tempo:            ${caricamento} ms`);
  const mb = (cs.n * 5 * 4) / 1024 / 1024;
  console.log(`memoria array:    ${mb.toFixed(1)} MB`);

  // La cache deve restituire la stessa istanza senza ricaricare.
  const t1 = Date.now();
  const cached = await loadConnections(sql, oggi);
  console.log(`cache:            ${Date.now() - t1} ms, stessa istanza: ${cached === cs}`);

  console.log(`\n── Invarianti ──`);

  let monotono = true;
  for (let i = 1; i < cs.n; i++) {
    if (cs.depTime[i] < cs.depTime[i - 1]) {
      monotono = false;
      console.log(`  ordinamento rotto in ${i}: ${cs.depTime[i - 1]} → ${cs.depTime[i]}`);
      break;
    }
  }
  console.log(`  ordinate per partenza:     ${monotono ? "sì" : "NO"}`);

  // >= e non >: le tratte di durata zero sono ammesse, vedi connections.ts.
  let crescenti = true;
  let durataZero = 0;
  for (let i = 0; i < cs.n; i++) {
    if (cs.arrTime[i] < cs.depTime[i]) {
      crescenti = false;
      console.log(`  arrivo prima della partenza in ${i}`);
      break;
    }
    if (cs.arrTime[i] === cs.depTime[i]) durataZero++;
  }
  console.log(`  arrivo non prima di partenza: ${crescenti ? "sì" : "NO"}`);
  console.log(`  tratte di durata zero:     ${durataZero.toLocaleString("it-IT")}`);

  let indiciValidi = true;
  for (let i = 0; i < cs.n; i++) {
    if (
      cs.depStop[i] < 0 || cs.depStop[i] >= cs.stopIds.length ||
      cs.arrStop[i] < 0 || cs.arrStop[i] >= cs.stopIds.length ||
      cs.tripIdx[i] < 0 || cs.tripIdx[i] >= cs.tripSourceId.length
    ) {
      indiciValidi = false;
      console.log(`  indice fuori range in ${i}`);
      break;
    }
  }
  console.log(`  indici nel range:          ${indiciValidi ? "sì" : "NO"}`);

  console.log(`  arco temporale:            ${hhmm(cs.depTime[0], cs.baseEpoch)} → ${hhmm(cs.depTime[cs.n - 1], cs.baseEpoch)}`);

  // Controprova sul dato: una connessione estratta a caso deve coincidere con
  // due righe consecutive di timetable per quella corsa.
  console.log(`\n── Controprova su una connessione ──`);
  const i = Math.floor(cs.n / 2);
  const trip = cs.tripSourceId[cs.tripIdx[i]];
  const da = cs.stopIds[cs.depStop[i]];
  const a = cs.stopIds[cs.arrStop[i]];
  console.log(`  corsa ${trip}: ${da} → ${a}`);
  console.log(`  connessione: ${hhmm(cs.depTime[i], cs.baseEpoch)} → ${hhmm(cs.arrTime[i], cs.baseEpoch)}`);

  const righe = await sql<{ stop_id: string; stop_sequence: number; departure_s: number }[]>`
    SELECT stop_id, stop_sequence, departure_s FROM timetable
    WHERE trip_id = ${trip} AND stop_id IN (${da}, ${a})
    ORDER BY stop_sequence
  `;
  for (const r of righe) {
    const h = Math.floor(r.departure_s / 3600);
    const m = Math.floor((r.departure_s % 3600) / 60);
    console.log(`  timetable: seq ${r.stop_sequence} ${r.stop_id} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }

  // ── Itinerari su percorsi controllabili a mano ──
  const fp = await loadFootpaths(sql, cs, oggi);
  console.log(`\n── Trasferimenti a piedi (≤500m) ──`);
  console.log(`  archi: ${fp.n.toLocaleString("it-IT")}`);

  // Mezzanotte di baseEpoch è il giorno PRIMA di oggi, quindi +86400 per oggi.
  const oggiAlle = (ora: number) => cs.baseEpoch + 86400 + ora * 3600;

  await provaViaggioCoord(cs, fp, { lat: 41.8902, lon: 12.4922, nome: "Colosseo" },
                                  { lat: 41.8300, lon: 12.4700, nome: "EUR Fermi" }, oggiAlle(10));
  await provaViaggioCoord(cs, fp, { lat: 41.9022, lon: 12.4539, nome: "San Pietro" },
                                  { lat: 41.8890, lon: 12.4700, nome: "Trastevere" }, oggiAlle(10));

  // Caso segnalato dall'utente: l'API rispondeva "vai a piedi" per 2267 metri
  // (37 minuti) invece di proporre il trasporto pubblico. Qui si controlla che
  // un itinerario in autobus esista davvero.
  await provaViaggio(cs, fp, "73780", "72453", oggiAlle(10), "Rapagnano/Apiro → Galline Bianche/Baccano");

  await provaViaggio(cs, fp, "73992", "70078", oggiAlle(10), "diretto sulla 64");
  await provaViaggio(cs, fp, "73992", "72983", oggiAlle(10), "corsa + trasferimento a piedi");
  // 24.5 = domani alle 00:30, l'ora in cui servono le corse con departure_s > 86400
  await provaViaggio(cs, fp, "73992", "70078", oggiAlle(24.5), "notturno oltre mezzanotte");

  await sql.end();
}

type Punto = { lat: number; lon: number; nome: string };

async function provaViaggioCoord(
  cs: ConnectionSet,
  fp: Awaited<ReturnType<typeof loadFootpaths>>,
  da: Punto,
  a: Punto,
  partenza: number,
) {
  console.log(`\n── ${da.nome} → ${a.nome} (da coordinate) ──`);

  const t0 = Date.now();
  const [access, egress] = await Promise.all([
    findAccess(sql, cs, da.lat, da.lon),
    findAccess(sql, cs, a.lat, a.lon),
  ]);
  const msAccess = Date.now() - t0;
  console.log(`  fermate di accesso: ${access.length} (la più vicina a ${access[0]?.meters}m), uscita: ${egress.length} (${egress[0]?.meters}m) · ${msAccess} ms`);

  if (access.length === 0 || egress.length === 0) {
    console.log(`  nessuna fermata nel raggio`);
    return;
  }

  const t1 = Date.now();
  const res = csaEarliestArrival(cs, fp, access, egress, partenza);
  const msCsa = Date.now() - t1;

  if (!res) {
    console.log(`  NESSUN ITINERARIO`);
    return;
  }

  const durata = Math.round((res.arriveAt - (partenza - cs.baseEpoch)) / 60);
  console.log(`  partenza ${hhmm(partenza - cs.baseEpoch, cs.baseEpoch)} → arrivo ${hhmm(res.arriveAt, cs.baseEpoch)} · ${durata} min · CSA ${msCsa} ms`);

  let camminoTot = 0;
  for (const leg of res.legs) {
    if (leg.kind === "walk") {
      camminoTot += leg.seconds;
      const x = leg.fromStop === null ? da.nome : await nomeFermata(cs.stopIds[leg.fromStop]);
      const y = leg.toStop === null ? a.nome : await nomeFermata(cs.stopIds[leg.toStop]);
      console.log(`    a piedi ${Math.round(leg.seconds / 60)} min: ${x} → ${y}`);
    } else {
      const tripId = cs.tripSourceId[leg.tripIdx];
      const meta = await sql<{ short_name: string; headsign: string | null }[]>`
        SELECT r.short_name, t.headsign FROM trips t
        JOIN routes r ON r.route_id = t.route_id WHERE t.trip_id = ${tripId}
      `;
      console.log(
        `    linea ${meta[0]?.short_name ?? "?"} verso ${meta[0]?.headsign ?? ""}: ` +
          `${await nomeFermata(cs.stopIds[leg.fromStop])} ${hhmm(leg.departAt, cs.baseEpoch)} → ` +
          `${await nomeFermata(cs.stopIds[leg.toStop])} ${hhmm(leg.arriveAt, cs.baseEpoch)}`,
      );
    }
  }
  console.log(`    cammino totale: ${Math.round(camminoTot / 60)} min`);
}

async function provaViaggio(
  cs: ConnectionSet,
  fp: Awaited<ReturnType<typeof loadFootpaths>>,
  fromId: string,
  toId: string,
  partenza: number,
  etichetta: string,
) {
  const from = cs.stopIndex.get(fromId);
  const to = cs.stopIndex.get(toId);
  console.log(`\n── ${etichetta} ──`);
  if (from === undefined || to === undefined) {
    console.log(`  fermata senza servizio nei giorni caricati`);
    return;
  }

  const nomi = await sql<{ stop_id: string; name: string }[]>`
    SELECT stop_id, name FROM stops WHERE stop_id IN (${fromId}, ${toId})
  `;
  const nome = (id: string) => nomi.find((n) => n.stop_id === id)?.name ?? id;
  console.log(`  da ${nome(fromId)} a ${nome(toId)}`);
  console.log(`  partenza richiesta: ${hhmm(partenza - cs.baseEpoch, cs.baseEpoch)}`);

  const t0 = Date.now();
  const res = csaEarliestArrival(cs, fp, [{ stop: from, seconds: 0 }], [{ stop: to, seconds: 0 }], partenza);
  const ms = Date.now() - t0;

  if (!res) {
    console.log(`  NESSUN ITINERARIO (${ms} ms)`);
    return;
  }

  console.log(`  arrivo: ${hhmm(res.arriveAt, cs.baseEpoch)}  ·  durata ${Math.round((res.arriveAt - (partenza - cs.baseEpoch)) / 60)} min  ·  ${ms} ms, ${res.scanned.toLocaleString("it-IT")} connessioni esaminate`);

  for (const leg of res.legs) {
    if (leg.kind === "walk") {
      const a = leg.fromStop === null ? "origine" : await nomeFermata(cs.stopIds[leg.fromStop]);
      const b = leg.toStop === null ? "destinazione" : await nomeFermata(cs.stopIds[leg.toStop]);
      console.log(`    a piedi ${Math.round(leg.seconds / 60)} min: ${a} → ${b}`);
    } else {
      const tripId = cs.tripSourceId[leg.tripIdx];
      const meta = await sql<{ short_name: string; headsign: string | null }[]>`
        SELECT r.short_name, t.headsign FROM trips t
        JOIN routes r ON r.route_id = t.route_id
        WHERE t.trip_id = ${tripId}
      `;
      const linea = meta[0]?.short_name ?? "?";
      const verso = meta[0]?.headsign ?? "";
      console.log(
        `    linea ${linea} verso ${verso}: ${await nomeFermata(cs.stopIds[leg.fromStop])} ${hhmm(leg.departAt, cs.baseEpoch)}` +
          ` → ${await nomeFermata(cs.stopIds[leg.toStop])} ${hhmm(leg.arriveAt, cs.baseEpoch)}`,
      );
      // Controprova: gli orari della tratta devono stare in timetable per quella corsa.
      const check = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM timetable
        WHERE trip_id = ${tripId}
          AND ((stop_id = ${cs.stopIds[leg.fromStop]} AND departure_s % 86400 = ${leg.departAt % 86400})
            OR (stop_id = ${cs.stopIds[leg.toStop]}   AND departure_s % 86400 = ${leg.arriveAt % 86400}))
      `;
      console.log(`      controprova in timetable: ${check[0].n}/2 capi coincidono`);
    }
  }
}

const cacheNomi = new Map<string, string>();
async function nomeFermata(stopId: string): Promise<string> {
  const hit = cacheNomi.get(stopId);
  if (hit) return hit;
  const r = await sql<{ name: string }[]>`SELECT name FROM stops WHERE stop_id = ${stopId}`;
  const n = r[0]?.name ?? stopId;
  cacheNomi.set(stopId, n);
  return n;
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
