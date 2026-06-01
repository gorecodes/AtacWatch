import type { StyleSpecification } from "maplibre-gl";

// Centro di Roma (P.zza Venezia) e bounds approssimativi dell'area servita
export const ROME_CENTER: [number, number] = [12.4823, 41.8955];

/**
 * Stile mappa: usa MapTiler se è configurata la chiave, altrimenti ricade su
 * un raster OpenStreetMap gratuito (ok per sviluppo / basso traffico).
 */
export function mapStyle(): string | StyleSpecification {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (key) {
    return `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${key}`;
  }
  return {
    version: 8,
    // Font per i livelli testo (numeri linea). Server pubblico CORS-enabled.
    glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap",
      },
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }],
  };
}
