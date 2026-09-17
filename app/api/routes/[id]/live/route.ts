import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

// Mezzi in tempo reale di una linea/verso, con la prossima fermata
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dir = Number(new URL(req.url).searchParams.get("dir") ?? "0");

  try {
    const sql = getSql();
    const rows = await sql`SELECT * FROM route_live(${id}, ${dir})`;
    return NextResponse.json(
      { vehicles: rows },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[routes/:id/live]", e);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }
}
