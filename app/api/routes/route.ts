import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

// Ricerca linee per numero/nome
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) return NextResponse.json({ routes: [] });

  const { data, error } = await getSupabase().rpc("search_routes", { q });
  if (error) {
    console.error("[routes/search]", error);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }

  return NextResponse.json(
    { routes: data ?? [] },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}
