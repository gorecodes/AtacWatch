/**
 * Esecuzione locale dell'ETL GTFS statico:  pnpm ingest:static
 * Legge DATABASE_URL da .env.local.
 */
import { config } from "dotenv";
import { ingestStatic } from "../lib/ingest-static";

config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL mancante in .env.local");
  process.exit(1);
}

ingestStatic({ databaseUrl, log: (m) => console.log(m) })
  .then((r) => {
    console.log("Risultato:", r);
    process.exit(0);
  })
  .catch((e) => {
    console.error("ETL fallito:", e);
    process.exit(1);
  });
