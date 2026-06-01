"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Arrival } from "@/lib/gtfs";
import { etaLabel, minutesUntil } from "@/lib/gtfs";
import { useFavorites } from "@/lib/favorites";
import { usePolling, useNow } from "@/lib/usePolling";
import RouteBadge from "./RouteBadge";

const REFRESH_MS = 30_000;
const MAX_SHOWN = 3;

function FavoriteCard({ stop_id, name, code }: { stop_id: string; name: string; code: string | null }) {
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [ready, setReady] = useState(false);
  const now = useNow(15000);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/stops/${encodeURIComponent(stop_id)}/arrivals`, { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setArrivals((json.arrivals ?? []).slice(0, MAX_SHOWN));
    } catch {
      // mantieni dati precedenti
    } finally {
      setReady(true);
    }
  }, [stop_id]);

  usePolling(load, REFRESH_MS, [load]);

  return (
    <Link
      href={`/stop/${encodeURIComponent(stop_id)}`}
      className="block rounded-xl border border-neutral-200 bg-white px-3 py-2.5 shadow-sm active:bg-neutral-100"
    >
      <div className="mb-2 flex items-baseline gap-1.5">
        <span className="text-sm font-semibold truncate">{name}</span>
        {code && <span className="text-xs text-neutral-400 shrink-0">#{code}</span>}
      </div>

      {!ready && (
        <p className="text-xs text-neutral-400">…</p>
      )}

      {ready && arrivals.length === 0 && (
        <p className="text-xs text-neutral-400">Nessun passaggio nei prossimi 90 min</p>
      )}

      {ready && arrivals.length > 0 && (
        <ul className="space-y-1">
          {arrivals.map((a, i) => (
            <li key={`${a.route_id}-${a.direction_id}-${a.eta_ts}-${i}`}
                className="flex items-center gap-2">
              <RouteBadge shortName={a.short_name} size="sm" />
              <span className="min-w-0 flex-1 truncate text-xs text-neutral-400">
                → {a.headsign ?? "—"}
              </span>
              <span className={`shrink-0 text-sm font-semibold tabular-nums ${
                a.is_realtime ? "text-emerald-600" : "text-neutral-700"
              }`}>
                {etaLabel(minutesUntil(a.eta_ts, now))}
              </span>
              {a.is_realtime && (
                <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" />
              )}
            </li>
          ))}
        </ul>
      )}
    </Link>
  );
}

export default function FavoriteStops() {
  const { favorites } = useFavorites();

  if (favorites.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold text-neutral-500">Preferiti</h2>
      <ul className="space-y-2">
        {favorites.map((f) => (
          <li key={f.stop_id}>
            <FavoriteCard {...f} />
          </li>
        ))}
      </ul>
    </section>
  );
}
