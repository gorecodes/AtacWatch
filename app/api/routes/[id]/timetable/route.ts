import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const stopId = url.searchParams.get("stop");
  const dirParam = url.searchParams.get("dir");
  const dateParam = url.searchParams.get("date");

  if (!stopId) return NextResponse.json({ error: "param stop mancante" }, { status: 400 });
  if (dirParam === null) return NextResponse.json({ error: "param dir mancante" }, { status: 400 });

  const dir = Number(dirParam);
  // p_date è opzionale: null fa usare alla funzione la data corrente
  const date: string | null = dateParam ?? null;

  try {
    const sql = getSql();
    const rows = await sql`SELECT * FROM line_full_timetable(${id}, ${stopId}, ${dir}, ${date})`;
    return NextResponse.json(
      { timetable: rows },
      { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } },
    );
  } catch (e) {
    console.error("[routes/:id/timetable]", e);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }
}
