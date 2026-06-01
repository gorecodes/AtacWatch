import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

// Mezzi nel riquadro visibile della mappa. bbox = minLon,minLat,maxLon,maxLat
export async function GET(req: Request) {
  const bbox = new URL(req.url).searchParams.get("bbox");
  const parts = bbox?.split(",").map(Number);
  if (!parts || parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ error: "bbox non valido" }, { status: 400 });
  }
  const [minLon, minLat, maxLon, maxLat] = parts;
  // Limita l'area richiesta: un bbox enorme restituirebbe sempre il cap di 1500
  // righe e farebbe scan inutili. ~0.5° (~55 km) copre abbondantemente Roma.
  const MAX_SPAN = 0.5;
  if (maxLon - minLon > MAX_SPAN || maxLat - minLat > MAX_SPAN || maxLon < minLon || maxLat < minLat) {
    return NextResponse.json({ error: "bbox troppo grande o non valido" }, { status: 400 });
  }

  const { data, error } = await getSupabase().rpc("vehicles_in_bbox", {
    min_lon: minLon, min_lat: minLat, max_lon: maxLon, max_lat: maxLat,
  });
  if (error) {
    console.error("[vehicles]", error);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }

  return NextResponse.json(
    { vehicles: data ?? [] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
