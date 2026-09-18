"use client";

import { useCallback, useState } from "react";
import { usePolling } from "@/lib/usePolling";

/**
 * Striscia sottile sopra la navigazione in basso: mostra quando ATAC ha
 * aggiornato il feed per l'ultima volta.
 *
 * Non è "quando il browser ha ricaricato": è l'orario in cui il worker ha
 * ricevuto dati freschi da ATAC. Se il feed si blocca, questa striscia lo
 * segnala immediatamente — senza di lei l'utente vedrebbe dati vecchi senza
 * capire perché i bus non arrivano mai.
 *
 * Tre stati:
 * - fresco (< 90s): un punto verde + "RT aggiornato Xs fa"
 * - stantio (90s–5min): arancione + "fermo da Xmin — dati non aggiornati"
 * - morto (> 5min): rosso + avviso esplicito
 *
 * La striscia è minimale: 20px, testo a 11px, non ruba spazio ai contenuti.
 */

type Stato = { last_fetch: string | null; stale_s: number | null };

function etichetta(stale: number): string {
  if (stale < 60) return `${stale}s fa`;
  const m = Math.round(stale / 60);
  return `${m} min fa`;
}

export default function FeedStatus() {
  const [stato, setStato] = useState<Stato | null>(null);

  const aggiorna = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) return;
      setStato(await res.json());
    } catch {
      // silenzioso: la striscia non compare in caso di errore di rete
    }
  }, []);

  // Ogni 30s: il worker aggiorna ogni 60s, quindi a 30s vediamo il cambio
  // entro un ciclo.
  usePolling(aggiorna, 30_000, [aggiorna]);

  if (!stato || stato.stale_s === null) return null;

  const s = stato.stale_s;
  // Sotto 90s: tutto ok, non serve disturbare.
  // Sopra: l'utente deve sapere.
  if (s < 90) {
    return (
      <div className="flex items-center justify-center gap-1.5 border-t border-neutral-200 bg-neutral-50 py-1 text-[11px] text-neutral-500">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-live-500" />
        RT aggiornato {etichetta(s)}
      </div>
    );
  }

  if (s < 300) {
    return (
      <div className="flex items-center justify-center gap-1.5 border-t border-amber-200 bg-amber-50 py-1 text-[11px] font-medium text-amber-700">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
        Feed fermo da {etichetta(s)} — dati non aggiornati
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center gap-1.5 border-t border-red-200 bg-red-50 py-1 text-[11px] font-medium text-red-700">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
      Feed ATAC fermo da {etichetta(s)} — gli orari potrebbero essere sbagliati
    </div>
  );
}
