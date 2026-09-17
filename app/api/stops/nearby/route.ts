import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

// Fermate vicine a una coordinata
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  const radiusRaw = Number(sp.get("r") ?? "600");
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat/lon mancanti" }, { status: 400 });
  }
  // Clamp del raggio: evita scan PostGIS arbitrariamente costosi (DoS).
  const radius = Math.min(Math.max(Number.isFinite(radiusRaw) ? radiusRaw : 600, 100), 2000);

  try {
    const sql = getSql();
    const rows = await sql`SELECT * FROM stops_nearby(${lat}, ${lon}, ${radius})`;
    return NextResponse.json(
      { stops: rows },
      { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } },
    );
  } catch (e) {
    console.error("[stops/nearby]", e);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }
}
