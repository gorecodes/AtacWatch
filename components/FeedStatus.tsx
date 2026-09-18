"use client";

import { useCallback, useState } from "react";
import { usePolling } from "@/lib/usePolling";

/**
 * Indicatore di stato del feed: quando ATAC ha aggiornato l'ultima volta.
 * Sta nella TopBar del layout, a sinistra del tasto tema. Testo umano,
 * niente sigle: "23s fa", "2 min fa", "dati fermi da 8 min".
 */

function etichetta(s: number): string {
  if (s < 60) return `${s}s fa`;
  return `${Math.round(s / 60)} min fa`;
}

export default function FeedStatus() {
  const [stale, setStale] = useState<number | null>(null);

  const aggiorna = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      if (typeof d.stale_s === "number") setStale(d.stale_s);
    } catch { /* silenzioso */ }
  }, []);

  usePolling(aggiorna, 30_000, [aggiorna]);

  if (stale === null) return null;

  const dot =
    stale < 90  ? "bg-live-500" :
    stale < 300 ? "bg-amber-500" :
                  "bg-red-500";

  const color =
    stale < 90  ? "text-neutral-400" :
    stale < 300 ? "text-amber-600" :
                  "text-red-600";

  const testo =
    stale < 300 ? etichetta(stale) :
                  `dati fermi da ${etichetta(stale)}`;

  return (
    <span className={`flex items-center gap-1.5 text-[11px] ${color}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      {testo}
    </span>
  );
}
