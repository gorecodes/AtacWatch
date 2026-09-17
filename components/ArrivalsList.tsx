"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import type { Arrival } from "@/lib/gtfs";
import { delayLabel } from "@/lib/gtfs";
import { usePolling, useNow } from "@/lib/usePolling";
import { useFavorites } from "@/lib/favorites";
import RouteBadge from "./RouteBadge";
import Eta from "./Eta";
import { BackGlyph, StarGlyph, LiveBeacon } from "./Glyphs";

type StopInfo = { stop_id: string; name: string; code: string | null } | null;
const REFRESH_MS = 15000;

export default function ArrivalsList({ stopId }: { stopId: string }) {
  const [stop, setStop] = useState<StopInfo>(null);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const { isFavorite, toggle } = useFavorites();
  const now = useNow(15000);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/stops/${encodeURIComponent(stopId)}/arrivals`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setStop(json.stop ?? null);
      setArrivals(json.arrivals ?? []);
      setUpdatedAt(new Date());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [stopId]);

  usePolling(load, REFRESH_MS, [load]);

  const starred = stop ? isFavorite(stopId) : false;

  return (
    <div className="mx-auto max-w-lg">
      {/* La targa. È l'unico blocco pieno dell'app, ed è deliberato: riprende
          l'insegna fisica della fermata, che è l'oggetto che si guarda mentre
          si aspetta. Il numero di palina è come i romani identificano una
          fermata, quindi qui è un dato, non un dettaglio tecnico. */}
      <header className="bg-neutral-900 px-4 pb-4 pt-4 text-white">
        <div className="mb-2.5 flex items-center justify-between">
          <Link
            href="/"
            aria-label="Torna alla home"
            className="-ml-1.5 flex items-center gap-1 rounded p-1.5 text-neutral-300 active:text-white"
          >
            <BackGlyph className="h-4 w-4" />
            <span className="text-[13px]">Home</span>
          </Link>

          <div className="flex items-center gap-3">
            {updatedAt && !error && (
              <span className="flex items-center gap-1.5 text-[12px] text-neutral-400">
                <LiveBeacon />
                {updatedAt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
            {stop && (
              <button
                onClick={() => toggle({ stop_id: stopId, name: stop.name, code: stop.code ?? null })}
                aria-pressed={starred}
                aria-label={starred ? "Rimuovi dai preferiti" : "Salva nei preferiti"}
                className={`-mr-1.5 rounded p-1.5 ${starred ? "text-white" : "text-neutral-400 active:text-white"}`}
              >
                <StarGlyph filled={starred} className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>

        <h1 className="name text-[27px] font-bold leading-[1.05] tracking-tight">
          {stop?.name ?? "Fermata"}
        </h1>
        {stop?.code && (
          <p className="mt-0.5 text-[13px] tabular-nums text-neutral-400">palina {stop.code}</p>
        )}
      </header>

      {/* La legenda una volta sola, invece di ripetere "tempo reale" /
          "orario programmato" su ogni riga: quella seconda riga raddoppiava
          l'altezza e dimezzava gli arrivi visibili. */}
      {arrivals.length > 0 && (
        <p className="px-4 pb-1 pt-2.5 text-[12px] text-neutral-500">
          In verde i mezzi tracciati in tempo reale, in grigio l&apos;orario previsto.
        </p>
      )}

      {loading && arrivals.length === 0 && (
        <p className="px-4 py-6 text-[14px] text-neutral-500">Leggo gli arrivi…</p>
      )}
      {error && arrivals.length === 0 && (
        <p className="px-4 py-6 text-[14px] text-neutral-500">
          Non riesco a leggere gli arrivi.{" "}
          <button onClick={load} className="font-medium text-brand-600 underline underline-offset-2">Riprova</button>
        </p>
      )}
      {!loading && !error && arrivals.length === 0 && (
        <p className="px-4 py-6 text-[14px] text-neutral-500">
          Nessun passaggio previsto nei prossimi 90 minuti da questa fermata.
        </p>
      )}

      <ul className="divide-y divide-neutral-200 px-4">
        {arrivals.map((a, i) => {
          const href = a.trip_id
            ? `/trip/${encodeURIComponent(a.trip_id)}`
            // Senza trip_id (arrivo programmato) si va alla linea: porto con me
            // il verso toccato, così la pagina apre la direzione giusta.
            : a.direction_id != null
              ? `/line/${encodeURIComponent(a.route_id)}?dir=${a.direction_id}`
              : `/line/${encodeURIComponent(a.route_id)}`;
          const delay = a.is_realtime ? delayLabel(a.delay) : null;
          return (
            <li key={`${a.route_id}-${a.direction_id}-${a.eta_ts}-${i}`}>
              <Link href={href} className="flex items-center gap-2.5 py-2.5 active:bg-neutral-200/40">
                <RouteBadge shortName={a.short_name} color={a.color} textColor={a.text_color} />

                <span className="name min-w-0 flex-1 truncate text-[15px] leading-snug text-neutral-900">
                  {a.headsign ?? "Destinazione non indicata"}
                </span>

                {delay && (
                  <span className="shrink-0 text-[12px] tabular-nums text-brand-500">{delay}</span>
                )}

                <Eta etaTs={a.eta_ts} isRealtime={a.is_realtime} now={now} />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
