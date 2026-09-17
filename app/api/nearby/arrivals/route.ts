import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { withRouteColors } from "@/lib/routeColors";

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

  try {
    const sql = getSql();
    const rows = await sql<{ route_id: string }[]>`
      SELECT * FROM nearby_arrivals(${lat}, ${lon}, ${radius}, ${25})
    `;
    const arrivals = await withRouteColors(rows);

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
  } catch (e) {
    console.error("[nearby/arrivals]", e);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }
}
