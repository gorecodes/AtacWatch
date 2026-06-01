import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

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

  const { data, error } = await getSupabase().rpc("stops_nearby", {
    p_lat: lat, p_lon: lon, p_radius_m: radius,
  });
  if (error) {
    console.error("[stops/nearby]", error);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }

  return NextResponse.json(
    { stops: data ?? [] },
    { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } },
  );
}
