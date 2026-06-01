/** Tipi e helper condivisi per i dati GTFS di Roma. */

/** route_type GTFS -> etichetta/icona. Roma usa principalmente 0,1,2,3. */
export const ROUTE_TYPE: Record<number, { label: string; icon: string }> = {
  0: { label: "Tram", icon: "🚊" },
  1: { label: "Metro", icon: "🚇" },
  2: { label: "Treno", icon: "🚆" },
  3: { label: "Bus", icon: "🚌" },
  4: { label: "Traghetto", icon: "⛴️" },
  5: { label: "Funicolare", icon: "🚡" },
  7: { label: "Funicolare", icon: "🚡" },
  11: { label: "Filobus", icon: "🚎" },
};

export function routeTypeInfo(type: number) {
  return ROUTE_TYPE[type] ?? { label: "Linea", icon: "🚌" };
}

export type Route = {
  route_id: string;
  short_name: string;
  long_name: string | null;
  type: number;
  color: string | null;
  text_color: string | null;
};

export type NearbyStop = {
  stop_id: string;
  name: string;
  code: string | null;
  lon: number;
  lat: number;
  distance_m: number;
  routes: string[];
};

export type StopResult = {
  stop_id: string;
  name: string;
  code: string | null;
  routes: string[] | null;
};

export type Arrival = {
  route_id: string;
  short_name: string;
  headsign: string | null;
  direction_id: number | null;
  trip_id: string | null;
  eta_ts: string; // ISO timestamp
  minutes: number;
  is_realtime: boolean;
  delay: number | null;
};

export type NearbyArrival = {
  route_id: string;
  short_name: string;
  headsign: string | null;
  direction_id: number | null;
  eta_ts: string;
  minutes: number;
  is_realtime: boolean;
  delay: number | null;
  stop_id: string;
  stop_name: string;
  stop_code: string | null;
  distance_m: number;
};

export type Vehicle = {
  vehicle_id: string;
  route_id: string | null;
  short_name: string | null;
  type: number | null;
  lon: number;
  lat: number;
  bearing: number | null;
  ts: string;
};

/** "25:30:00" -> 91800. Gestisce ore GTFS oltre le 24h. */
export function gtfsTimeToSeconds(t: string): number | null {
  const m = t?.trim().match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Secondi-da-mezzanotte -> "HH:MM" (modulo 24h per la visualizzazione). */
export function secondsToHHMM(s: number): string {
  const h = Math.floor(s / 3600) % 24;
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Minuti mancanti a un istante ISO, calcolati ORA lato client (stesso floor del
 * server). Evita che l'etichetta resti ferma tra un refresh e l'altro.
 */
export function minutesUntil(iso: string, nowMs: number = Date.now()): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - nowMs) / 60000));
}

/** Minuti al passaggio -> etichetta leggibile. */
export function etaLabel(minutes: number): string {
  if (minutes <= 0) return "in arrivo";
  if (minutes === 1) return "1 min";
  return `${minutes} min`;
}

/** Colore di sfondo per il badge linea (fallback grigio). */
export function routeBadgeStyle(color: string | null, textColor: string | null) {
  const bg = color ? `#${color.replace("#", "")}` : "#1f2937";
  const fg = textColor ? `#${textColor.replace("#", "")}` : "#ffffff";
  return { backgroundColor: bg, color: fg };
}
