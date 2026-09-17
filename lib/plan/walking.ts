/**
 * Distanze a piedi reali, da OSRM con profilo pedonale.
 *
 * Perché serve: le distanze in linea d'aria non sbagliano solo il numero
 * mostrato, sbagliano gli ITINERARI. Se il router crede che una fermata sia a
 * sei minuti quando la strada reale è molto più lunga, ci costruisce sopra
 * coincidenze che non esistono. A Roma l'errore è grosso ovunque ci sia di
 * mezzo il Tevere, un fascio di binari o una ferrovia da scavalcare.
 *
 * Il servizio gira in un container a parte (vedi docker-compose.yml) su un
 * estratto della sola Roma. Se non risponde si ripiega sulla linea d'aria per
 * un fattore di detour: un itinerario approssimato è meglio di una pagina
 * rotta, e il calcolo percorsi non deve poter mettere giù il resto dell'app.
 */
import { WALK_SPEED_MS, walkSeconds } from "./policy";

const BASE = process.env.OSRM_URL ?? "http://osrm:5000";
const TIMEOUT_MS = 4000;

export type Camminata = { meters: number; seconds: number; reale: boolean };

/** true se l'ultima chiamata è andata a vuoto: serve a dichiararlo nella UI. */
let ultimoRipiego = false;
export function ripiegoAttivo() {
  return ultimoRipiego;
}

function approssima(metriLineaAria: number): Camminata {
  return { meters: metriLineaAria, seconds: walkSeconds(metriLineaAria), reale: false };
}

async function chiedi(path: string): Promise<unknown | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Distanze da un punto a molte fermate in una sola chiamata.
 *
 * Usa il servizio `table` di OSRM, che è fatto esattamente per questo: una
 * matrice sorgente-destinazioni. Chiamare `route` quaranta volte costerebbe
 * quaranta richieste.
 */
export async function distanzeDaPunto(
  lat: number,
  lon: number,
  destinazioni: { lat: number; lon: number; metriLineaAria: number }[],
  verso: "andata" | "ritorno" = "andata",
): Promise<Camminata[]> {
  if (destinazioni.length === 0) return [];

  const punti = [
    `${lon},${lat}`,
    ...destinazioni.map((d) => `${d.lon},${d.lat}`),
  ].join(";");
  const indici = destinazioni.map((_, i) => i + 1).join(";");
  // "ritorno" inverte i ruoli: dalle fermate al punto. A piedi la differenza è
  // minima, ma i sensi unici pedonali e i sottopassi non sono sempre simmetrici.
  const query =
    verso === "andata"
      ? `sources=0&destinations=${indici}`
      : `sources=${indici}&destinations=0`;

  const json = (await chiedi(
    `/table/v1/foot/${punti}?annotations=distance,duration&${query}`,
  )) as { code?: string; distances?: number[][]; durations?: number[][] } | null;

  if (!json || json.code !== "Ok" || !json.distances) {
    ultimoRipiego = true;
    return destinazioni.map((d) => approssima(d.metriLineaAria));
  }
  ultimoRipiego = false;

  // Con sources=0 la matrice ha una riga; con destinations=0 ne ha una per
  // fermata e una sola colonna.
  const leggi = (i: number): number | null => {
    const m = json.distances!;
    const v = verso === "andata" ? m[0]?.[i] : m[i]?.[0];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };

  return destinazioni.map((d, i) => {
    const metri = leggi(i);
    // OSRM restituisce null quando la fermata non è raggiungibile a piedi dalla
    // rete stradale: in quel caso l'approssimazione è tutto ciò che resta.
    if (metri === null) return approssima(d.metriLineaAria);
    return { meters: Math.round(metri), seconds: Math.round(metri / WALK_SPEED_MS), reale: true };
  });
}

/** Distanza a piedi tra due punti, per il confronto "ci arrivo a piedi". */
export async function distanzaTraPunti(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  metriLineaAria: number,
): Promise<Camminata> {
  const json = (await chiedi(
    `/route/v1/foot/${fromLon},${fromLat};${toLon},${toLat}?overview=false`,
  )) as { code?: string; routes?: { distance: number; duration: number }[] } | null;

  const r = json?.routes?.[0];
  if (!json || json.code !== "Ok" || !r) {
    ultimoRipiego = true;
    return approssima(metriLineaAria);
  }
  ultimoRipiego = false;
  return {
    meters: Math.round(r.distance),
    seconds: Math.round(r.distance / WALK_SPEED_MS),
    reale: true,
  };
}
