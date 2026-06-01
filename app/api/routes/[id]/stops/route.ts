import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

// Fermate ordinate + tracciato (GeoJSON) di una linea per verso
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dir = Number(new URL(req.url).searchParams.get("dir") ?? "0");
  const supabase = getSupabase();

  const [stops, shape] = await Promise.all([
    supabase.rpc("route_stops_geo", { p_route_id: id, p_direction_id: dir }),
    supabase.rpc("route_shape_geojson", { p_route_id: id, p_direction_id: dir }),
  ]);

  if (stops.error) {
    console.error("[routes/:id/stops]", stops.error);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }

  return NextResponse.json(
    { stops: stops.data ?? [], shape: shape.data ? JSON.parse(shape.data as string) : null },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
