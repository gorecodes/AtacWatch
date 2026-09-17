import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

// Ricerca linee per numero/nome
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) return NextResponse.json({ routes: [] });

  try {
    const sql = getSql();
    const rows = await sql`SELECT * FROM search_routes(${q})`;
    return NextResponse.json(
      { routes: rows },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (e) {
    console.error("[routes/search]", e);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }
}
