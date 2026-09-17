/**
 * Ricalcola la tabella transfers con le distanze a piedi REALI.
 *
 * I trasferimenti fermata-fermata sono precalcolati (0019_transfers.sql) e
 * nascono in linea d'aria. Vale per loro lo stesso difetto degli accessi: due
 * fermate a 300 metri in linea d'aria possono averne 3000 di strada se in
 * mezzo c'è il Tevere, una ferrovia o una carreggiata che non si attraversa, e
 * il router ci costruisce sopra coincidenze che non esistono.
 *
 * Essendo precalcolati si correggono una volta sola, interrogando OSRM a
 * blocchi: una chiamata `table` per gruppo di destinazioni, e un solo UPDATE
 * per fermata di partenza. Trecentomila round-trip costerebbero minuti.
 *
 * Le coppie la cui distanza reale supera il limite vengono ELIMINATE: non sono
 * trasferimenti, sono un'illusione della retta.
 *
 * Uso:
 *   DATABASE_URL=... OSRM_URL=http://127.0.0.1:5001 npx tsx scripts/transfers-real.ts
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
const osrm = process.env.OSRM_URL ?? "http://127.0.0.1:5001";
if (!url) {
  console.error("DATABASE_URL mancante");
  process.exit(1);
}

/** Oltre questa distanza reale non è un trasferimento a piedi sensato. */
const LIMITE_M = 800;

/**
 * Destinazioni per richiesta. OSRM gira con --max-table-size 200 e RIFIUTA
 * l'intera richiesta se le coordinate la superano: una fermata di centro con
 * 200 destinazioni entro 800 metri faceva fallire il proprio blocco, e sul VPS
 * sono rimaste 208 fermate coi valori in linea d'aria. Si spezza, con margine
 * per la coordinata di partenza.
 */
const BLOCCO = 150;

const TIMEOUT_MS = 20_000;

const sql = postgres(url, { ssl: false, max: 4 });

type Riga = { from_stop_id: string; to_stop_id: string; meters: number };
type Punto = { stop_id: string; lat: number; lon: number };
type Coord = Map<string, Punto>;

async function chiediTabella(punti: string, indici: string): Promise<(number | null)[] | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `${osrm}/table/v1/foot/${punti}?annotations=distance&sources=0&destinations=${indici}`,
      { signal: ctrl.signal },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { code?: string; distances?: (number | null)[][] };
    return j.code === "Ok" && j.distances?.[0] ? j.distances[0] : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Distanze reali da una fermata a tutte le sue destinazioni, a blocchi. */
async function distanzeReali(
  p: Punto,
  validi: Riga[],
  coord: Coord,
): Promise<(number | null)[] | null> {
  const out: (number | null)[] = [];
  for (let i = 0; i < validi.length; i += BLOCCO) {
    const blocco = validi.slice(i, i + BLOCCO);
    const punti = [
      `${p.lon},${p.lat}`,
      ...blocco.map((d) => {
        const c = coord.get(d.to_stop_id)!;
        return `${c.lon},${c.lat}`;
      }),
    ].join(";");
    const indici = blocco.map((_, k) => k + 1).join(";");
    const d = await chiediTabella(punti, indici);
    // Un blocco mancante invaliderebbe l'allineamento con le righe: meglio
    // riprovare l'intera fermata che scrivere distanze sfalsate.
    if (!d) return null;
    out.push(...d);
  }
  return out;
}

async function elabora(p: Punto, coord: Coord): Promise<{ agg: number; eli: number } | null> {
  const dest = await sql<Riga[]>`
    SELECT from_stop_id, to_stop_id, meters FROM transfers
    WHERE from_stop_id = ${p.stop_id}
    ORDER BY to_stop_id
  `;
  const validi = dest.filter((d) => coord.has(d.to_stop_id));
  if (validi.length === 0) return { agg: 0, eli: 0 };

  const distanze = await distanzeReali(p, validi, coord);
  if (!distanze) return null;

  const nuovi: Riga[] = [];
  const daEliminare: string[] = [];
  validi.forEach((d, i) => {
    const m = distanze[i];
    if (m === null || !Number.isFinite(m) || m > LIMITE_M) daEliminare.push(d.to_stop_id);
    else nuovi.push({ ...d, meters: Math.round(m) });
  });

  if (daEliminare.length > 0) {
    await sql`
      DELETE FROM transfers
      WHERE from_stop_id = ${p.stop_id} AND to_stop_id = ANY(${daEliminare})
    `;
  }
  if (nuovi.length > 0) {
    await sql`
      UPDATE transfers t SET meters = v.meters
      FROM (SELECT * FROM json_to_recordset(${sql.json(nuovi as unknown as never)}::json)
            AS x(from_stop_id text, to_stop_id text, meters int)) v
      WHERE t.from_stop_id = v.from_stop_id AND t.to_stop_id = v.to_stop_id
    `;
  }
  return { agg: nuovi.length, eli: daEliminare.length };
}

async function main() {
  const partenze = await sql<Punto[]>`
    SELECT DISTINCT t.from_stop_id AS stop_id,
           st_y(s.geom)::float8 AS lat, st_x(s.geom)::float8 AS lon
    FROM transfers t JOIN stops s ON s.stop_id = t.from_stop_id
    ORDER BY 1
  `;
  console.log(`${partenze.length} fermate di partenza da elaborare`);

  const coord: Coord = new Map(
    (await sql<Punto[]>`
      SELECT stop_id, st_y(geom)::float8 AS lat, st_x(geom)::float8 AS lon FROM stops
    `).map((s) => [s.stop_id, s]),
  );

  let aggiornate = 0;
  let eliminate = 0;
  let fatte = 0;
  const daRiprovare: Punto[] = [];

  for (const p of partenze) {
    const r = await elabora(p, coord);
    if (!r) {
      daRiprovare.push(p);
    } else {
      aggiornate += r.agg;
      eliminate += r.eli;
    }
    if (++fatte % 500 === 0) {
      console.log(`  ${fatte}/${partenze.length} — ${aggiornate} aggiornate, ${eliminate} eliminate`);
    }
  }

  // Secondo tentativo sulle fermate senza risposta: un errore isolato di rete o
  // una lentezza momentanea di OSRM non deve lasciare valori in linea d'aria in
  // tabella, perché sono proprio quelli che producono itinerari impossibili.
  let irrisolte = 0;
  if (daRiprovare.length > 0) {
    console.log(`\nSecondo tentativo su ${daRiprovare.length} fermate…`);
    for (const p of daRiprovare) {
      const r = await elabora(p, coord);
      if (!r) irrisolte++;
      else {
        aggiornate += r.agg;
        eliminate += r.eli;
      }
    }
  }

  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM transfers`;
  console.log(
    `\nFatto: ${aggiornate} coppie aggiornate, ${eliminate} eliminate perché irraggiungibili, ` +
      `${irrisolte} fermate ancora senza risposta. In tabella restano ${n} trasferimenti.`,
  );
  if (irrisolte > 0) {
    console.log(
      "Le fermate irrisolte conservano le distanze in linea d'aria: rilanciare lo script le riprende.",
    );
  }
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
