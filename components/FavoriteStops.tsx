"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import type { Arrival } from "@/lib/gtfs";
import { useFavorites } from "@/lib/favorites";
import { usePolling, useNow } from "@/lib/usePolling";
import RouteBadge from "./RouteBadge";
import Eta from "./Eta";

const REFRESH_MS = 30_000;
const MAX_SHOWN = 3;

function FavoriteCard({ stop_id, name }: { stop_id: string; name: string }) {
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
    <Link href={`/stop/${encodeURIComponent(stop_id)}`} className="block py-2.5 active:bg-neutral-200/40">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="name min-w-0 flex-1 truncate text-[15px] font-semibold text-neutral-900">
          {name}
        </span>
        <span className="shrink-0 text-neutral-300">›</span>
      </div>

      {!ready && <p className="text-[13px] text-neutral-400">…</p>}

      {ready && arrivals.length === 0 && (
        <p className="text-[13px] text-neutral-500">Nessun passaggio nei prossimi 90 minuti</p>
      )}

      {ready && arrivals.length > 0 && (
        <ul className="space-y-0.5">
          {arrivals.map((a, i) => (
            <li key={`${a.route_id}-${a.direction_id}-${a.eta_ts}-${i}`} className="flex items-center gap-2">
              <RouteBadge shortName={a.short_name} color={a.color} textColor={a.text_color} size="sm" />
              <span className="name min-w-0 flex-1 truncate text-[13px] text-neutral-500">
                {a.headsign ?? "—"}
              </span>
              <Eta etaTs={a.eta_ts} isRealtime={a.is_realtime} now={now} size="sm" />
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
    <section>
      <h2 className="mb-1 text-[15px] font-semibold text-neutral-900">Preferiti</h2>
      <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
        {favorites.map((f) => (
          <li key={f.stop_id}>
            <FavoriteCard stop_id={f.stop_id} name={f.name} />
          </li>
        ))}
      </ul>
    </section>
  );
}
