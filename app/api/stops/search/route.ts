import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

// Ricerca fermate per numero (codice palina) o nome
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) return NextResponse.json({ stops: [] });

  const { data, error } = await getSupabase().rpc("search_stops", { q });
  if (error) {
    console.error("[stops/search]", error);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }

  return NextResponse.json(
    { stops: data ?? [] },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}
