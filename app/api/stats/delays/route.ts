import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

/**
 * Classifica delle linee per puntualità, da delay_stats.
 *
 * È la cosa che nessuna app concorrente può mostrare, perché richiede di aver
 * osservato il feed per giorni: Moovit e Google mostrano il presente, non la
 * storia. Il worker campiona a ogni tick lo scostamento della prossima fermata
 * di ogni corsa attiva (vedi 0016 e 0025).
 *
 * SOGLIA DI CAMPIONE. Sotto un certo numero di osservazioni una percentuale è
 * rumore travestito da dato: una linea vista dieci volte, di cui tre in
 * ritardo, non è "in ritardo nel 30% dei casi". Le linee sotto soglia non
 * compaiono, e il numero di osservazioni è mostrato accanto a ogni riga perché
 * chi legge possa giudicare da sé.
 */
const MIN_CAMPIONI = 200;

export async function GET() {
  try {
    const sql = getSql();

    const [periodo] = await sql<
      { dal: string | null; al: string | null; campioni: number | null; ore: number }[]
    >`
      SELECT min(hour_bucket)::text AS dal,
             max(hour_bucket)::text AS al,
             sum(sample_count)::int AS campioni,
             count(DISTINCT hour_bucket)::int AS ore
      FROM delay_stats
    `;

    const linee = await sql<
      {
        short_name: string;
        color: string | null;
        text_color: string | null;
        campioni: number;
        media_s: number;
        perc_ritardo: number;
        peggiore_s: number;
      }[]
    >`
      SELECT r.short_name,
             r.color,
             r.text_color,
             sum(d.sample_count)::int AS campioni,
             round(sum(d.delay_sum)::numeric / sum(d.sample_count))::int AS media_s,
             round(100.0 * sum(d.late_count) / sum(d.sample_count))::int AS perc_ritardo,
             max(d.delay_max)::int AS peggiore_s
      FROM delay_stats d
      JOIN routes r ON r.route_id = d.route_id
      GROUP BY r.short_name, r.color, r.text_color
      HAVING sum(d.sample_count) >= ${MIN_CAMPIONI}
      ORDER BY perc_ritardo DESC, media_s DESC
      LIMIT 40
    `;

    return NextResponse.json(
      {
        periodo: {
          dal: periodo?.dal ?? null,
          al: periodo?.al ?? null,
          campioni: periodo?.campioni ?? 0,
          ore: periodo?.ore ?? 0,
        },
        minCampioni: MIN_CAMPIONI,
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
