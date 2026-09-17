/**
 * Worker RT — entry point.
 *
 * Esegue ingestRt() subito all'avvio, poi ogni 60 secondi.
 * Un errore in una singola run viene loggato ma non crashano il processo:
 * la run successiva parte normalmente.
 *
 * Avvio:  node_modules/.bin/tsx worker/index.ts
 * (via Dockerfile.worker: CMD ["node_modules/.bin/tsx", "worker/index.ts"])
 */
import postgres from "postgres";
import { ingestRt } from "./ingest-rt.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[worker] DATABASE_URL mancante");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  ssl: false,        // DB interno a Docker, no TLS
  max: 5,            // pool piccola: il worker fa un upsert alla volta
  idle_timeout: 60,
  connect_timeout: 10,
});

async function tick() {
  const t0 = Date.now();
  const result = await ingestRt(sql);
  const ms = Date.now() - t0;
  if (result.ok) {
    const { vehicles, tripUpdates, alerts } = result.stats;
    console.log(`[worker] ok (${ms}ms) — vehicles:${vehicles} tu:${tripUpdates} alerts:${alerts}`);
  } else {
    console.error(`[worker] errore (${ms}ms):`, result.error);
  }
}

// Prima run immediata, poi ogni 60s
console.log("[worker] avviato, prima run...");
tick();
const interval = setInterval(tick, 60_000);

// Graceful shutdown su SIGTERM (docker stop) e SIGINT (Ctrl+C)
async function shutdown(signal: string) {
  console.log(`[worker] ${signal} ricevuto, chiusura...`);
  clearInterval(interval);
  await sql.end({ timeout: 5 });
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
