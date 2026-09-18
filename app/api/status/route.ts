import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

/**
 * Stato del feed in tempo reale: quando ATAC ha aggiornato l'ultima volta.
 *
 * Non è "quando il browser ha aggiornato la pagina" (quello è un dato locale,
 * e varia da device a device). È l'orario in cui il worker ha ricevuto dati
 * freschi da ATAC e li ha scritti in DB. La differenza conta: se il worker
 * si ferma o il feed ATAC si blocca, il browser continua a ricaricare
 * felicemente dati vecchi senza che nessuno se ne accorga.
 *
 * Restituisce anche `stale_s`: i secondi da quando il feed è stato
 * aggiornato l'ultima volta. Sopra 120s qualcosa non va.
 */
export async function GET() {
  try {
    const sql = getSql();
    const [row] = await sql<{ last_fetch: string; stale_s: number }[]>`
      select max(last_fetch)::text as last_fetch,
             extract(epoch from (now() - max(last_fetch)))::int as stale_s
      from feed_meta
      where feed in ('trip_updates', 'vehicles')
    `;
    return NextResponse.json(
      { last_fetch: row?.last_fetch ?? null, stale_s: row?.stale_s ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[status]", e);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }
}
