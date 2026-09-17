import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

/**
 * Ricerca unificata per i capi di un percorso: fermate E indirizzi nello
 * stesso elenco.
 *
 * Sono due tabelle diverse (stops dal GTFS, places da OSM) ma per chi cerca
 * sono la stessa cosa — "dove voglio andare" — quindi arrivano insieme. Le
 * fermate vengono prima a parità di testo: chi digita il nome di una fermata
 * di solito vuole quella, e in più su una fermata l'app sa dire gli arrivi.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 3) return NextResponse.json({ results: [] });

  try {
    const sql = getSql();
    const [fermate, luoghi] = await Promise.all([
      sql<{ stop_id: string; name: string; code: string | null }[]>`
        SELECT stop_id, name, code FROM stops
        WHERE name ILIKE ${"%" + q + "%"} OR code = ${q}
        ORDER BY (code = ${q}) DESC, length(name), name
        LIMIT 6
      `,
      sql<{ id: string; kind: string; label: string; locality: string | null; lon: number; lat: number }[]>`
        SELECT * FROM search_places(${q})
      `,
    ]);

    const results = [
      ...fermate.map((s) => ({
        kind: "stop" as const,
        id: s.stop_id,
        label: s.name,
        detail: s.code ? `palina ${s.code}` : null,
        stopId: s.stop_id,
        lat: null as number | null,
        lon: null as number | null,
      })),
      ...luoghi.slice(0, 10).map((p) => ({
        kind: p.kind as "street" | "address" | "poi",
        id: p.id,
        label: p.label,
        // Il riferimento di zona è la fermata più vicina: a Roma prende il
        // nome dall'incrocio, quindi dice davvero dove si è.
        detail: p.locality ?? (p.kind === "street" ? "via" : p.kind === "address" ? "indirizzo" : "luogo"),
        stopId: null as string | null,
        lat: p.lat,
        lon: p.lon,
      })),
    ];

    return NextResponse.json(
      { results },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" } },
    );
  } catch (e) {
    console.error("[geocode]", e);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }
}
