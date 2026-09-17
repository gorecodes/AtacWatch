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
 * blocchi: una chiamata `table` per fermata di partenza, con tutte le sue
 * destinazioni insieme.
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

const sql = postgres(url, { ssl: false, max: 4 });

type Riga = { from_stop_id: string; to_stop_id: string; meters: number };

async function main() {
  const partenze = await sql<{ stop_id: string; lat: number; lon: number }[]>`
    SELECT DISTINCT t.from_stop_id AS stop_id,
           st_y(s.geom)::float8 AS lat, st_x(s.geom)::float8 AS lon
    FROM transfers t JOIN stops s ON s.stop_id = t.from_stop_id
    ORDER BY 1
  `;
  console.log(`${partenze.length} fermate di partenza da elaborare`);

  const coord = new Map(
    (
      await sql<{ stop_id: string; lat: number; lon: number }[]>`
        SELECT stop_id, st_y(geom)::float8 AS lat, st_x(geom)::float8 AS lon FROM stops
      `
    ).map((s) => [s.stop_id, s]),
  );

  let fatte = 0;
  let aggiornate = 0;
  let eliminate = 0;
  let falliti = 0;

  for (const p of partenze) {
    const dest = await sql<Riga[]>`
      SELECT from_stop_id, to_stop_id, meters FROM transfers
      WHERE from_stop_id = ${p.stop_id}
      ORDER BY to_stop_id
    `;
    const validi = dest.filter((d) => coord.has(d.to_stop_id));
    if (validi.length === 0) continue;

    const punti = [
      `${p.lon},${p.lat}`,
      ...validi.map((d) => {
        const c = coord.get(d.to_stop_id)!;
        return `${c.lon},${c.lat}`;
      }),
    ].join(";");
    const indici = validi.map((_, i) => i + 1).join(";");

    let distanze: (number | null)[] | null = null;
    try {
      const res = await fetch(
        `${osrm}/table/v1/foot/${punti}?annotations=distance&sources=0&destinations=${indici}`,
      );
      if (res.ok) {
        const j = (await res.json()) as { code?: string; distances?: (number | null)[][] };
        if (j.code === "Ok" && j.distances?.[0]) distanze = j.distances[0];
      }
    } catch {
      // gestito sotto
    }

    if (!distanze) {
      falliti++;
      continue; // le coppie restano come sono: meglio il valore vecchio che nessuno
    }

    // Una sola istruzione per fermata invece di una per coppia: sono 300.000
    // coppie, e un round-trip a testa costerebbe minuti.
    const nuovi: { from_stop_id: string; to_stop_id: string; meters: number }[] = [];
    const daEliminare: string[] = [];
    validi.forEach((d, i) => {
      const m = distanze![i];
      if (m === null || !Number.isFinite(m) || m > LIMITE_M) {
        daEliminare.push(d.to_stop_id);
      } else {
        nuovi.push({ from_stop_id: d.from_stop_id, to_stop_id: d.to_stop_id, meters: Math.round(m) });
      }
    });

    if (daEliminare.length > 0) {
      await sql`
        DELETE FROM transfers
        WHERE from_stop_id = ${p.stop_id} AND to_stop_id = ANY(${daEliminare})
      `;
      eliminate += daEliminare.length;
    }
    if (nuovi.length > 0) {
      await sql`
        UPDATE transfers t SET meters = v.meters
        FROM (SELECT * FROM json_to_recordset(${sql.json(nuovi as unknown as never)}::json)
              AS x(from_stop_id text, to_stop_id text, meters int)) v
        WHERE t.from_stop_id = v.from_stop_id AND t.to_stop_id = v.to_stop_id
      `;
      aggiornate += nuovi.length;
    }

    fatte++;
    if (fatte % 500 === 0) {
      console.log(`  ${fatte}/${partenze.length} fermate — ${aggiornate} aggiornate, ${eliminate} eliminate`);
    }
  }

  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM transfers`;
  console.log(
    `\nFatto: ${aggiornate} coppie aggiornate, ${eliminate} eliminate perché irraggiungibili, ` +
      `${falliti} fermate senza risposta da OSRM. In tabella restano ${n} trasferimenti.`,
  );
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
