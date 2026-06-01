import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

// Arrivi alla fermata (realtime + orario programmato) + anagrafica fermata
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabase();

  const [stop, arrivals] = await Promise.all([
    supabase.from("stops").select("stop_id, name, code").eq("stop_id", id).maybeSingle(),
    supabase.rpc("stop_arrivals", { p_stop_id: id }),
  ]);

  if (arrivals.error) {
    console.error("[stops/:id/arrivals]", arrivals.error);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }

  return NextResponse.json(
    { stop: stop.data, arrivals: arrivals.data ?? [] },
    { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } },
  );
}
