import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

// Fermate ordinate + tracciato (GeoJSON) di una linea per verso
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dir = Number(new URL(req.url).searchParams.get("dir") ?? "0");

  try {
    const sql = getSql();
    const [stops, shapeRows] = await Promise.all([
      sql`SELECT * FROM route_stops_geo(${id}, ${dir})`,
      sql`SELECT route_shape_geojson(${id}, ${dir}) AS geojson`,
    ]);

    const rawGeojson = (shapeRows[0] as { geojson: string | null } | undefined)?.geojson ?? null;
    return NextResponse.json(
      { stops, shape: rawGeojson ? JSON.parse(rawGeojson) : null },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch (e) {
    console.error("[routes/:id/stops]", e);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }
}
