"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import type { Arrival } from "@/lib/gtfs";
import { etaLabel, minutesUntil } from "@/lib/gtfs";
import { usePolling, useNow } from "@/lib/usePolling";
import { useFavorites } from "@/lib/favorites";
import RouteBadge from "./RouteBadge";

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

  return (
    <div className="mx-auto max-w-lg">
      <header className="flex items-center gap-3 px-4 pt-5 pb-3">
        <Link href="/" aria-label="Torna alla home" className="text-xl text-neutral-400">‹</Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">
            {stop?.name ?? "Fermata"}
            {stop?.code && <span className="ml-2 text-sm font-normal text-neutral-500">#{stop.code}</span>}
          </h1>
          <p className="text-xs text-neutral-500">
            {updatedAt ? `Aggiornato alle ${updatedAt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "…"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {stop && (
            <button
              onClick={() => toggle({ stop_id: stopId, name: stop.name, code: stop.code ?? null })}
              aria-label={isFavorite(stopId) ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}
              className="text-xl leading-none"
            >
              {isFavorite(stopId) ? "★" : "☆"}
            </button>
          )}
          <button onClick={load} className="text-xs text-sky-400">Aggiorna</button>
        </div>
      </header>

      {loading && arrivals.length === 0 && <p className="px-4 py-6 text-sm text-neutral-500">Carico gli arrivi…</p>}
      {error && arrivals.length === 0 && (
        <p className="px-4 py-6 text-sm text-neutral-500">
          Impossibile caricare gli arrivi.{" "}
          <button onClick={load} className="text-sky-400 underline">Riprova</button>.
        </p>
      )}
      {!loading && !error && arrivals.length === 0 && (
        <p className="px-4 py-6 text-sm text-neutral-500">Nessun passaggio previsto nei prossimi 90 minuti.</p>
      )}

      <ul className="divide-y divide-neutral-800 px-4">
        {arrivals.map((a, i) => {
          const href = a.trip_id
            ? `/trip/${encodeURIComponent(a.trip_id)}`
            // Senza trip_id (arrivo programmato) si va alla linea: porto con me
            // il verso toccato, così la pagina apre la direzione giusta.
            : a.direction_id != null
              ? `/line/${encodeURIComponent(a.route_id)}?dir=${a.direction_id}`
              : `/line/${encodeURIComponent(a.route_id)}`;
          return (
            <li key={`${a.route_id}-${a.direction_id}-${a.eta_ts}-${i}`}>
              <Link href={href} className="flex items-center gap-3 py-3 active:opacity-70">
                <RouteBadge shortName={a.short_name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">→ {a.headsign ?? "—"}</p>
                  <p className="flex items-center gap-1.5 text-xs text-neutral-500">
                    {a.is_realtime ? (
                      <>
                        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                        tempo reale
                      </>
                    ) : (
                      <>🕐 orario programmato</>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1 text-right">
                  <span className={`text-base font-semibold tabular-nums ${a.is_realtime ? "text-emerald-400" : "text-neutral-200"}`}>
                    {etaLabel(minutesUntil(a.eta_ts, now))}
                  </span>
                  <span className="text-neutral-600">›</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
