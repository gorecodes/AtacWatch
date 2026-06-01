import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

// Mezzi in tempo reale di una linea/verso, con la prossima fermata
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dir = Number(new URL(req.url).searchParams.get("dir") ?? "0");

  const { data, error } = await getSupabase().rpc("route_live", {
    p_route_id: id, p_direction_id: dir,
  });
  if (error) {
    console.error("[routes/:id/live]", error);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }

  return NextResponse.json(
    { vehicles: data ?? [] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
