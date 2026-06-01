import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

// Dettaglio linea: anagrafica + versi disponibili
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabase();

  const [route, directions] = await Promise.all([
    supabase.from("routes").select("*").eq("route_id", id).maybeSingle(),
    supabase.rpc("route_directions", { p_route_id: id }),
  ]);

  if (route.error) {
    console.error("[routes/:id]", route.error);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }
  if (!route.data) return NextResponse.json({ error: "linea non trovata" }, { status: 404 });

  return NextResponse.json(
    { route: route.data, directions: directions.data ?? [] },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
