import { getSql } from "@/lib/db";

/**
 * Colori ufficiali delle linee, dal GTFS.
 *
 * Nel feed di Roma solo 4 linee su 434 hanno un colore (le metro: MEA, MEB,
 * MEB1, MEC). Conviene quindi caricare l'intera mappa una volta e tenerla in
 * cache, invece di fare una join o una lookup a ogni richiesta di arrivi.
 * I colori cambiano solo con l'ETL statico, che gira una volta al giorno.
 */
type RouteColor = { color: string | null; text_color: string | null };

let cache: Map<string, RouteColor> | null = null;
let loadedAt = 0;
const TTL = 60 * 60_000; // 1 ora

async function colorMap(): Promise<Map<string, RouteColor>> {
  if (cache && Date.now() - loadedAt < TTL) return cache;
  const sql = getSql();
  const rows = await sql<{ route_id: string; color: string | null; text_color: string | null }[]>`
    SELECT route_id, color, text_color
      FROM routes
     WHERE color IS NOT NULL AND color <> ''
  `;
  cache = new Map(rows.map((r) => [r.route_id, { color: r.color, text_color: r.text_color }]));
  loadedAt = Date.now();
  return cache;
}

/** Aggiunge color/text_color alle righe che hanno un route_id. */
export async function withRouteColors<T extends { route_id: string }>(
  rows: T[],
): Promise<(T & RouteColor)[]> {
  if (rows.length === 0) return [];
  const colors = await colorMap();
  return rows.map((r) => ({
    ...r,
    color: colors.get(r.route_id)?.color ?? null,
    text_color: colors.get(r.route_id)?.text_color ?? null,
  }));
}
