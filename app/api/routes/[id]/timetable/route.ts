import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const stopId = url.searchParams.get("stop");
  const dirParam = url.searchParams.get("dir");
  const dateParam = url.searchParams.get("date");

  if (!stopId) return NextResponse.json({ error: "param stop mancante" }, { status: 400 });
  if (dirParam === null) return NextResponse.json({ error: "param dir mancante" }, { status: 400 });

  const rpcParams: Record<string, unknown> = {
    p_route_id: id,
    p_stop_id: stopId,
    p_direction_id: Number(dirParam),
  };
  if (dateParam) rpcParams.p_date = dateParam;

  const { data, error } = await getSupabase().rpc("line_full_timetable", rpcParams);
  if (error) {
    console.error("[routes/:id/timetable]", error);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }

  return NextResponse.json(
    { timetable: data ?? [] },
    { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } },
  );
}
