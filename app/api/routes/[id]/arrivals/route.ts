import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

// Prossimi passaggi di questa linea a una fermata (param ?stop=)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stopId = new URL(req.url).searchParams.get("stop");
  if (!stopId) return NextResponse.json({ error: "param stop mancante" }, { status: 400 });

  const { data, error } = await getSupabase().rpc("route_stop_arrivals", {
    p_route_id: id, p_stop_id: stopId,
  });
  if (error) {
    console.error("[routes/:id/arrivals]", error);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }

  return NextResponse.json(
    { arrivals: data ?? [] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
