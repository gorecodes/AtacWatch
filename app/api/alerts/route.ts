import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { normalizza, type AvvisoRaw, type Avviso } from "@/lib/avvisi";

/**
 * Avvisi di servizio ATAC, filtrabili per linea o per fermata.
 *
 * Il feed li raccogliamo dal primo giorno e non li mostravamo da nessuna
 * parte: 181 avvisi riscritti nel database ogni minuto e letti da zero righe
 * di interfaccia. Nel frattempo l'app mostrava allegramente gli orari di una
 * linea sospesa.
 *
 *   ?route=<route_id>  avvisi di quella linea
 *   ?stop=<stop_id>    avvisi delle linee che servono quella fermata
 *   (niente)           tutti gli avvisi attivi
 *
 * `stop_ids` nel feed è praticamente sempre vuoto (3 avvisi su 181), quindi
 * il collegamento con la fermata passa per le linee che ci fermano: è
 * un'inferenza nostra, non un dato ATAC, e per questo sulla fermata mostriamo
 * solo gli avvisi urgenti — quelli strutturali di tutte le linee che passano
 * per un nodo affollato sarebbero una lista infinita e inutile.
 */
export async function GET(req: Request) {
  try {
    const sql = getSql();
    const url = new URL(req.url);
    const route = url.searchParams.get("route");
    const stop = url.searchParams.get("stop");

    let righe: AvvisoRaw[];

    if (route) {
      righe = await sql<AvvisoRaw[]>`
        select id, header, description, cause, effect, route_ids,
               start_ts::text, end_ts::text
          from service_alerts
         where ${route} = any(route_ids)
      `;
    } else if (stop) {
      // Gli avvisi delle linee che servono la fermata.
      //
      // `linee_qui` è l'intersezione tra le linee dell'avviso e quelle che
      // fermano QUI, ed è indispensabile: l'avviso di Piazza Venezia riguarda
      // 12 linee, ma a una fermata servita solo dalla 60 mostrarne dodici
      // sarebbe incomprensibile. Si usa lo short_name perché "60" è il nome
      // che la gente conosce, non il route_id interno.
      righe = await sql<AvvisoRaw[]>`
        select a.id, a.header, a.description, a.cause, a.effect, a.route_ids,
               a.start_ts::text, a.end_ts::text,
               (select array_agg(distinct r.short_name order by r.short_name)
                  from route_stops rs
                  join routes r on r.route_id = rs.route_id
                 where rs.stop_id = ${stop}
                   and rs.route_id = any(a.route_ids)) as linee_qui
          from service_alerts a
         where exists (
                 select 1 from route_stops rs
                  where rs.stop_id = ${stop}
                    and rs.route_id = any(a.route_ids)
               )
      `;
    } else {
      righe = await sql<AvvisoRaw[]>`
        select id, header, description, cause, effect, route_ids,
               start_ts::text, end_ts::text
          from service_alerts
      `;
    }

    // La normalizzazione scarta gli avvisi scaduti e quelli troppo in là nel
    // futuro, quindi il conteggio va fatto DOPO.
    const avvisi = righe
      .map((r) => normalizza(r))
      .filter((a): a is Avviso => a !== null)
      // Prima gli urgenti, poi per titolo così l'ordine è stabile tra le
      // ricariche e la lista non balla sotto gli occhi.
      .sort((a, b) => (a.urgente === b.urgente ? a.titolo.localeCompare(b.titolo) : a.urgente ? -1 : 1));

    return NextResponse.json(
      { avvisi, urgenti: avvisi.filter((a) => a.urgente).length },
      // Gli avvisi cambiano di rado: un minuto di cache non fa perdere nulla
      // e togliere una query dal percorso di ogni apertura di pagina.
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (e) {
    console.error("[alerts]", e);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }
}
