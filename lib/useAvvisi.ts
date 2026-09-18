"use client";

import { useCallback, useState } from "react";
import { usePolling } from "./usePolling";
import type { Avviso } from "./avvisi";

/**
 * Avvisi di servizio per una linea o per una fermata.
 *
 * Estratto dal componente perché la pagina fermata non vuole un riquadro:
 * vuole marcare le righe degli arrivi delle linee coinvolte, e per farlo le
 * serve il dato, non un pezzo di interfaccia.
 */
export function useAvvisi({ routeId, stopId }: { routeId?: string; stopId?: string }) {
  const [avvisi, setAvvisi] = useState<Avviso[] | null>(null);

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
      // Un avviso che non si carica non deve rompere la lista degli arrivi,
      // che è il motivo per cui l'utente ha aperto l'app.
    }
  }, [routeId, stopId]);

  // Cinque minuti: gli avvisi non cambiano al minuto come gli arrivi.
  usePolling(carica, 5 * 60_000, [carica]);

  return avvisi;
}

/**
 * short_name della linea → avvisi che la riguardano a questa fermata.
 *
 * Solo gli urgenti: un cantiere è attivo per mesi, e un triangolo giallo
 * permanente sulla riga della 60 è il modo più efficace di insegnare alla
 * gente a ignorare i triangoli gialli.
 */
export function avvisiPerLinea(avvisi: Avviso[] | null): Map<string, Avviso[]> {
  const m = new Map<string, Avviso[]>();
  if (!avvisi) return m;
  for (const a of avvisi) {
    if (!a.urgente) continue;
    for (const linea of a.lineeQui) {
      const l = m.get(linea);
      if (l) l.push(a);
      else m.set(linea, [a]);
    }
  }
  return m;
}
