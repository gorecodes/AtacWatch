import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

// Prossimi passaggi di questa linea a una fermata (param ?stop=)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stopId = new URL(req.url).searchParams.get("stop");
  if (!stopId) return NextResponse.json({ error: "param stop mancante" }, { status: 400 });

  try {
    const sql = getSql();
    const rows = await sql`SELECT * FROM route_stop_arrivals(${id}, ${stopId})`;
    return NextResponse.json(
      { arrivals: rows },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[routes/:id/arrivals]", e);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }
}
