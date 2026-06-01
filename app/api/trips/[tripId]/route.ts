import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

// Dettaglio di una corsa: linea, mezzo (posizione attuale) e fermate previste
export async function GET(_req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const supabase = getSupabase();

  const [vehicle, stops, trip] = await Promise.all([
    supabase
      .from("vehicle_positions")
      .select("vehicle_id, route_id, direction_id, lat, lon, bearing, ts")
      .eq("trip_id", tripId)
      .maybeSingle(),
    supabase.rpc("trip_stops", { p_trip_id: tripId }),
    // headsign/verso ESATTI della corsa dal GTFS statico (non l'ultima fermata
    // nota in trip_updates, che può essere una fermata intermedia).
    supabase.from("trips").select("route_id, direction_id, headsign").eq("trip_id", tripId).maybeSingle(),
  ]);

  if (stops.error) {
    console.error("[trips/:tripId]", stops.error);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }

  // route_id: dal mezzo, dalla corsa statica, oppure dal primo trip_update
  let routeId: string | null = vehicle.data?.route_id ?? trip.data?.route_id ?? null;
  if (!routeId) {
    const tu = await supabase.from("trip_updates").select("route_id").eq("trip_id", tripId).limit(1).maybeSingle();
    routeId = tu.data?.route_id ?? null;
  }

  let route = null;
  if (routeId) {
    const r = await supabase.from("routes").select("*").eq("route_id", routeId).maybeSingle();
    route = r.data;
  }

  return NextResponse.json(
    {
      route,
      vehicle: vehicle.data ?? null,
      stops: stops.data ?? [],
      headsign: trip.data?.headsign ?? null,
      direction_id: trip.data?.direction_id ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
