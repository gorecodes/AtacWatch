/** Tipi dell'itinerario restituito da /api/plan, condivisi tra pianificatore e dettaglio. */

export type FermataItinerario = {
  stopId: string;
  name: string;
  code: string | null;
  /** Per disegnare l'itinerario su una mappa. Nulle se la fermata non si trova. */
  lat: number | null;
  lon: number | null;
};

export type TrattaItinerario =
  | {
      kind: "walk";
      from: FermataItinerario | null;
      to: FermataItinerario | null;
      minutes: number;
      meters?: number;
    }
  | {
      kind: "ride";
      tripId: string;
      shortName: string;
      color: string | null;
      textColor: string | null;
      headsign: string | null;
      from: FermataItinerario;
      to: FermataItinerario;
      departAt: string;
      arriveAt: string;
      minutes: number;
    };

export type OpzioneItinerario = {
  departAt: string;
  arriveAt: string;
  /** Da quando esci di casa a quando arrivi: non include l'attesa iniziale. */
  durationMin: number;
  /** Gli orari sono di una corsa a titolo d'esempio, non "la" partenza. */
  esempio: boolean;
  walkMin: number;
  rides: number;
  lines: string[];
  legs: TrattaItinerario[];
};

export type PianoItinerario = {
  options: OpzioneItinerario[];
  walkOption: { minutes: number; meters: number } | null;
};

export function oraLocale(iso: string): string {
  return new Date(iso).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Rome",
  });
}
