import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

// Dettaglio di una corsa: linea, mezzo (posizione attuale) e fermate previste
export async function GET(_req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;

  try {
    const sql = getSql();

    const [vehicleRows, stops, tripRows] = await Promise.all([
      sql`SELECT vehicle_id, route_id, direction_id, lat, lon, bearing, ts
          FROM vehicle_positions WHERE trip_id = ${tripId} LIMIT 1`,
      sql`SELECT * FROM trip_stops(${tripId})`,
      // headsign/verso ESATTI della corsa dal GTFS statico (non l'ultima fermata
      // nota in trip_updates, che può essere una fermata intermedia).
      sql`SELECT route_id, direction_id, headsign FROM trips WHERE trip_id = ${tripId} LIMIT 1`,
    ]);

    const vehicle = vehicleRows[0] ?? null;
    const trip = tripRows[0] ?? null;

    // route_id: dal mezzo, dalla corsa statica, oppure dal primo trip_update
    let routeId: string | null = (vehicle as { route_id?: string } | null)?.route_id
      ?? (trip as { route_id?: string } | null)?.route_id
      ?? null;

    if (!routeId) {
      const tuRows = await sql`SELECT route_id FROM trip_updates WHERE trip_id = ${tripId} LIMIT 1`;
      routeId = (tuRows[0] as { route_id?: string } | undefined)?.route_id ?? null;
    }

    let route = null;
    if (routeId) {
      const routeRows = await sql`SELECT * FROM routes WHERE route_id = ${routeId} LIMIT 1`;
      route = routeRows[0] ?? null;
    }

    return NextResponse.json(
      {
        route,
        vehicle,
        stops,
        headsign: (trip as { headsign?: string } | null)?.headsign ?? null,
        direction_id: (trip as { direction_id?: number } | null)?.direction_id ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[trips/:tripId]", e);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }
}
