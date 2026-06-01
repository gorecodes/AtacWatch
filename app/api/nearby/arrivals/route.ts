import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

// Cache in-memory: evita chiamate DB ripetute dallo stesso utente nel polling.
// Chiave: lat/lon arrotondati a 3 decimali (~100m) + raggio. TTL: 25 secondi.
const cache = new Map<string, { arrivals: unknown[]; ts: number }>();
const CACHE_TTL = 25_000;

function cacheKey(lat: number, lon: number, r: number) {
  return `${lat.toFixed(3)},${lon.toFixed(3)},${r}`;
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const lat = parseFloat(p.get("lat") ?? "");
  const lon = parseFloat(p.get("lon") ?? "");
  const radius = Math.min(Math.max(parseFloat(p.get("r") ?? "700"), 100), 2000);

  if (isNaN(lat) || isNaN(lon)) {
    return NextResponse.json({ error: "lat/lon mancanti" }, { status: 400 });
  }

  const key = cacheKey(lat, lon, radius);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json(
      { arrivals: cached.arrivals },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const { data, error } = await getSupabase().rpc("nearby_arrivals", {
    p_lat: lat,
    p_lon: lon,
    p_radius_m: radius,
    p_horizon_min: 25,
  });

  if (error) {
    console.error("[nearby/arrivals]", error);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }

  const arrivals = data ?? [];
  cache.set(key, { arrivals, ts: Date.now() });

  // Pulizia voci scadute per non far crescere la Map indefinitamente
  if (cache.size > 200) {
    const cutoff = Date.now() - CACHE_TTL;
    for (const [k, v] of cache) {
      if (v.ts < cutoff) cache.delete(k);
    }
  }

  return NextResponse.json(
    { arrivals },
    { headers: { "Cache-Control": "no-store" } },
  );
}
