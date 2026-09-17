import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

// Dettaglio linea: anagrafica + versi disponibili
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const sql = getSql();
    const [routeRows, directions] = await Promise.all([
      sql`SELECT * FROM routes WHERE route_id = ${id} LIMIT 1`,
      sql`SELECT * FROM route_directions(${id})`,
    ]);

    if (!routeRows[0]) return NextResponse.json({ error: "linea non trovata" }, { status: 404 });

    return NextResponse.json(
      { route: routeRows[0], directions },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch (e) {
    console.error("[routes/:id]", e);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }
}
