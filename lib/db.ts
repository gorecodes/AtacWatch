/**
 * Singleton postgres.js — unico punto di accesso al DB nell'app Next.js.
 *
 * Sostituisce lib/supabase.ts: non serve più PostgREST né anon key/JWT/RLS.
 * Tutte le query passano direttamente dal server Next.js a PostgreSQL.
 *
 * Uso nelle route:
 *   import { getSql } from "@/lib/db";
 *   const sql = getSql();
 *   const rows = await sql`SELECT * FROM fn(${p1}, ${p2})`;
 */
import postgres from "postgres";

// In Next.js (dev) il modulo può essere rivalutato da HMR: evitiamo di aprire
// una nuova pool a ogni hot-reload conservando l'istanza nel global di Node.
declare global {
  // eslint-disable-next-line no-var
  var __pgSql: ReturnType<typeof postgres> | undefined;
}

export function getSql(): ReturnType<typeof postgres> {
  if (!global.__pgSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL mancante");
    global.__pgSql = postgres(url, {
      max: 10,             // connessioni nella pool
      idle_timeout: 30,    // chiude connessioni inattive dopo 30s
      connect_timeout: 10, // timeout connessione iniziale
    });
  }
  return global.__pgSql;
}
