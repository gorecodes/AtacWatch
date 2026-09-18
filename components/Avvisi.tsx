"use client";

import { useCallback, useState } from "react";
import { usePolling } from "@/lib/usePolling";
import type { Avviso } from "@/lib/avvisi";

/**
 * Avvisi di servizio in contesto: sulla pagina della linea e su quella della
 * fermata, dove servono a cambiare una decisione.
 *
 * DUE PESI DIVERSI, ed è il punto di tutta la feature:
 *
 *   - urgente (manifestazione, incidente, polizia: dura un giorno) → riquadro
 *     ambrato, aperto, impossibile non vederlo. È la notizia di oggi.
 *   - strutturale (cantiere: dura mesi) → una riga grigia, chiusa, che si
 *     apre se uno vuole. È contesto, non allarme. Metterlo in rosso vorrebbe
 *     dire marchiare mezza rete di Roma in permanenza, e un avviso sempre
 *     acceso non lo legge più nessuno dopo tre giorni.
 *
 * Sulla fermata si passa `soloUrgenti`: il collegamento fermata→avviso è
 * un'inferenza dalle linee che ci passano, e su un nodo affollato i cantieri
 * di dieci linee diverse sarebbero rumore puro.
 */
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
  const [aperti, setAperti] = useState<Set<string>>(new Set());

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
    <div className="mb-3 space-y-1.5">
      {mostrati.map((a) => {
        const aperto = aperti.has(a.id);
        const toggle = () =>
          setAperti((s) => {
            const n = new Set(s);
            if (n.has(a.id)) n.delete(a.id);
            else n.add(a.id);
            return n;
          });

        if (a.urgente) {
          return (
            <div
              key={a.id}
              className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900"
            >
              <p className="text-[13px] font-bold leading-snug">
                {a.effetto}
                {a.causa && <span className="font-medium"> · {a.causa}</span>}
                {a.quando && <span className="font-medium"> · {a.quando}</span>}
              </p>
              <p className="mt-0.5 text-[13px] leading-snug">{a.titolo}</p>
              {a.dettaglio && (
                <p className="mt-1 text-[12px] leading-relaxed text-amber-800">{a.dettaglio}</p>
              )}
            </div>
          );
        }

        // Strutturale: una riga, tono basso, apribile.
        return (
          <div key={a.id} className="rounded border border-neutral-300 bg-neutral-50">
            <button
              onClick={toggle}
              aria-expanded={aperto}
              className="flex w-full items-start gap-2 px-3 py-2 text-left"
            >
              <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-400" />
              <span className="min-w-0 flex-1 text-[12px] leading-snug text-neutral-600">
                <span className="font-semibold text-neutral-800">{a.effetto}</span>
                {a.causa && ` per ${a.causa}`}
                {a.quando && ` · ${a.quando}`}
              </span>
            </button>
            {aperto && (
              <div className="border-t border-neutral-200 px-3 py-2">
                <p className="text-[12px] leading-relaxed text-neutral-700">{a.titolo}</p>
                {a.dettaglio && (
                  <p className="mt-1 text-[12px] leading-relaxed text-neutral-500">{a.dettaglio}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
