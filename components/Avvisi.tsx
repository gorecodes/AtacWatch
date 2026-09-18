"use client";

import { useCallback, useState } from "react";
import { usePolling } from "@/lib/usePolling";
import type { Avviso } from "@/lib/avvisi";

/**
 * Avvisi di servizio in contesto, in UNA RIGA.
 *
 * La prima versione usava riquadri pieni ambrati: troppo invadenti, e sulla
 * pagina della fermata mettevano un blocco di colore prima del dato per cui
 * l'utente ha aperto l'app. Qui il peso è quello di una nota: testo piccolo,
 * un pallino, niente sfondo. Si apre col tocco se si vuole il testo completo.
 *
 * LA LINEA VA DETTA. Sulla fermata "deviata per manifestazione" senza dire
 * DEVIATA CHI è inutile: la fermata è servita da otto linee. `lineeQui`
 * contiene solo le linee dell'avviso che fermano lì, calcolate dall'API —
 * l'avviso di Piazza Venezia riguarda 12 linee, ma a una fermata servita
 * dalla sola 60 va scritto "60".
 *
 * NOTA: sulla pagina fermata questo componente non si usa più — le righe
 * degli arrivi portano il loro avviso (vedi ArrivalsList). Resta in uso sulla
 * pagina della linea, dove l'avviso riguarda il soggetto della pagina intera.
 */

/**
 * Da "Deviata" a "una deviazione", perché la frase diventa "la 51 con una
 * deviazione sul percorso": afferma che il disservizio esiste sulla linea,
 * non che sia a questa fermata.
 */
function etichettaIndiretta(effetto: string): string {
  switch (effetto) {
    case "Deviata":            return "una deviazione";
    case "Percorso modificato": return "il percorso modificato";
    case "Servizio sospeso":   return "tratte sospese";
    case "Servizio ridotto":   return "servizio ridotto";
    case "Forti ritardi":      return "forti ritardi";
    case "Fermata spostata":   return "una fermata spostata";
    case "Corse aggiuntive":   return "corse aggiuntive";
    default:                   return "un avviso";
  }
}

export default function Avvisi({
  routeId,
  stopId,
  soloUrgenti = false,
}: {
  routeId?: string;
  stopId?: string;
  soloUrgenti?: boolean;
}) {
  const [avvisi, setAvvisi] = useState<Avviso[] | null>(null);
  const [aperto, setAperto] = useState<string | null>(null);

  const carica = useCallback(async () => {
    const q = routeId ? `?route=${encodeURIComponent(routeId)}`
            : stopId  ? `?stop=${encodeURIComponent(stopId)}`
            : "";
    try {
      const res = await fetch(`/api/alerts${q}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setAvvisi(json.avvisi ?? []);
    } catch {
      // Un avviso che non si carica non deve rompere la pagina degli arrivi,
      // che è il motivo per cui l'utente è qui.
    }
  }, [routeId, stopId]);

  // Cinque minuti: gli avvisi non cambiano al minuto come gli arrivi.
  usePolling(carica, 5 * 60_000, [carica]);

  if (!avvisi) return null;
  const mostrati = soloUrgenti ? avvisi.filter((a) => a.urgente) : avvisi;
  if (mostrati.length === 0) return null;

  return (
    <ul className="space-y-1">
      {mostrati.map((a) => {
        const espanso = aperto === a.id;
        // Sulla pagina della linea il nome è già nel titolo della pagina:
        // ripeterlo in ogni riga è ridondante.
        const linee = routeId ? [] : a.lineeQui;
        return (
          <li key={a.id}>
            <button
              onClick={() => setAperto(espanso ? null : a.id)}
              aria-expanded={espanso}
              className="flex w-full items-start gap-1.5 py-0.5 text-left"
            >
              <span
                className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${
                  a.urgente ? "bg-warn-500" : "bg-neutral-400"
                }`}
              />
              <span className="min-w-0 flex-1 text-[12px] leading-snug">
                {linee.length > 0 && (
                  <span className="font-bold text-neutral-900">
                    {linee.slice(0, 4).join(", ")}
                    {linee.length > 4 && ` +${linee.length - 4}`}{" "}
                  </span>
                )}
                <span className={a.urgente ? "text-warn-700" : "text-neutral-500"}>
                  {/* LE PAROLE CONTANO. Sulla fermata sappiamo che la linea è
                      deviata da qualche parte, non che lo sia QUI: ATAC
                      dichiara le fermate coinvolte in 3 avvisi su 181. Dire
                      "51 deviata" a una fermata a venti chilometri dal
                      cantiere è falso, quindi lì si dice che la linea HA una
                      deviazione, e solo con toccaQui si afferma che riguarda
                      questa fermata. */}
                  {linee.length === 0
                    ? `${a.effetto}${a.causa ? ` per ${a.causa}` : ""}`
                    : a.toccaQui
                      ? `${a.effetto.toLowerCase()} qui${a.causa ? ` per ${a.causa}` : ""}`
                      : `con ${etichettaIndiretta(a.effetto)}${a.causa ? ` per ${a.causa}` : ""} sul percorso`}
                  {a.quando && ` · ${a.quando}`}
                </span>
              </span>
            </button>
            {espanso && (
              <div className="ml-3 border-l border-neutral-300 pl-2.5 pb-1">
                <p className="text-[12px] leading-relaxed text-neutral-700">{a.titolo}</p>
                {a.dettaglio && (
                  <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-500">
                    {a.dettaglio}
                  </p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
