"use client";

import { useCallback, useState } from "react";
import { usePolling } from "@/lib/usePolling";

/**
 * Indicatore di stato del feed RT: quando ATAC ha aggiornato l'ultima volta.
 *
 * Sta in cima a ogni pagina, sempre visibile, allineato a destra così non
 * interferisce con titoli e tasti. Dimensione minima: non deve rubare spazio
 * ma deve essere leggibile a colpo d'occhio.
 *
 * Tre stati:
 * - fresco (< 90s): pallino verde + "RT · Xs fa"
 * - stantio (90s–5min): pallino arancione + "RT · Xmin fa"
 * - morto (> 5min): pallino rosso + "ATAC fermo · Xmin"
 *
 * Non compare finché il primo dato non arriva (null): evita il flash di
 * una striscia vuota al montaggio.
 */

type Stato = { last_fetch: string | null; stale_s: number | null };

function etichetta(s: number): string {
  if (s < 60) return `${s}s fa`;
  return `${Math.round(s / 60)}min fa`;
}

export default function FeedStatus() {
  const [stato, setStato] = useState<Stato | null>(null);

  const aggiorna = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) return;
      setStato(await res.json());
    } catch { /* silenzioso */ }
  }, []);

  usePolling(aggiorna, 30_000, [aggiorna]);

  if (!stato || stato.stale_s === null) return null;

  const s = stato.stale_s;

  const dot =
    s < 90  ? "bg-live-500" :
    s < 300 ? "bg-amber-500" :
              "bg-red-500";

  const text =
    s < 90  ? `text-neutral-400` :
    s < 300 ? `text-amber-600` :
              `text-red-600`;

  const label =
    s < 300 ? `RT · ${etichetta(s)}` :
              `ATAC fermo · ${etichetta(s)}`;

  return (
    <div className={`flex items-center justify-end gap-1.5 px-4 py-1 text-[11px] ${text}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      {label}
    </div>
  );
}
