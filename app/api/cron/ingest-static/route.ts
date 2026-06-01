import { NextResponse } from "next/server";
import { ingestStatic } from "@/lib/ingest-static";

// Job pesante: niente cache, runtime Node (yauzl/postgres), durata massima.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300; // sec (Pro). Su Hobby viene limitato: vedi fallback locale.

export async function GET(req: Request) {
  // Vercel Cron invia "Authorization: Bearer $CRON_SECRET"
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ error: "DATABASE_URL mancante" }, { status: 500 });
  }

  try {
    const result = await ingestStatic({ databaseUrl, log: (m) => console.log("[ingest-static]", m) });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error("[ingest-static] errore", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
