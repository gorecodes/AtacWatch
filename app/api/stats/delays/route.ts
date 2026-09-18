import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

/**
 * Classifica delle linee per puntualità, da delay_stats.
 *
 * È la cosa che nessuna app concorrente può mostrare, perché richiede di aver
 * osservato il feed per giorni: Moovit e Google mostrano il presente, non la
 * storia. Il worker campiona il ritardo alla prossima fermata di ogni corsa
 * attiva (vedi 0016, 0025, 0026 e 0027).
 *
 * UNITÀ DI MISURA: la corsa, non l'osservazione. Fino alla 0027 si contava
 * una riga per tick, quindi la stessa corsa entrava nel campione decine di
 * volte e le percentuali dicevano "per quanto tempo il mezzo che guardavo era
 * in ritardo" invece di "quante corse arrivano in ritardo". Ora ogni corsa
 * pesa una volta per fascia oraria.
 *
 * SOGLIA DI RITARDO: 5 minuti, non 2. Due minuti su un bus urbano non li nota
 * nessuno, e su una linea il cui orario GTFS è ottimista di tre minuti
 * facevano risultare in ritardo ogni singola corsa pur essendo regolare.
 * `late_count` (> 2 min) resta in tabella se un domani servisse.
 */
const MIN_CORSE = 100;

export async function GET() {
  try {
    const sql = getSql();

    const [periodo] = await sql<
      { dal: string | null; al: string | null; corse: number | null; ore: number }[]
    >`
      SELECT min(hour_bucket)::text AS dal,
             max(hour_bucket)::text AS al,
             sum(sample_count)::int AS corse,
             count(DISTINCT hour_bucket)::int AS ore
      FROM delay_stats
    `;

    const linee = await sql<
      {
        short_name: string;
        color: string | null;
        text_color: string | null;
        corse: number;
        media_s: number;
        perc_ritardo: number;
        peggiore_s: number;
      }[]
    >`
      SELECT r.short_name,
             r.color,
             r.text_color,
             sum(d.sample_count)::int AS corse,
             round(sum(d.delay_sum)::numeric / sum(d.sample_count))::int AS media_s,
             round(100.0 * sum(d.late5_count) / sum(d.sample_count))::int AS perc_ritardo,
             max(d.delay_max)::int AS peggiore_s
      FROM delay_stats d
      JOIN routes r ON r.route_id = d.route_id
      GROUP BY r.short_name, r.color, r.text_color
      HAVING sum(d.sample_count) >= ${MIN_CORSE}
      ORDER BY perc_ritardo DESC, media_s DESC
      LIMIT 40
    `;

    return NextResponse.json(
      {
        periodo: {
          dal: periodo?.dal ?? null,
          al: periodo?.al ?? null,
          corse: periodo?.corse ?? 0,
          ore: periodo?.ore ?? 0,
        },
        minCorse: MIN_CORSE,
        linee,
      },
      // I dati cambiano una volta all'ora: non vale interrogare il DB a ogni
      // apertura della pagina.
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } },
    );
  } catch (e) {
    console.error("[stats/delays]", e);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }
}
