import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { withRouteColors } from "@/lib/routeColors";

// Arrivi alla fermata (realtime + orario programmato) + anagrafica fermata
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const sql = getSql();
    const [stopRows, rows] = await Promise.all([
      sql`SELECT stop_id, name, code FROM stops WHERE stop_id = ${id} LIMIT 1`,
      sql<{ route_id: string }[]>`SELECT * FROM stop_arrivals(${id})`,
    ]);
    const arrivals = await withRouteColors(rows);

    return NextResponse.json(
      { stop: stopRows[0] ?? null, arrivals },
      { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } },
    );
  } catch (e) {
    console.error("[stops/:id/arrivals]", e);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }
}
