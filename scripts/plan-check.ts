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
import { loadConnections } from "../lib/plan/connections";

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

  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
