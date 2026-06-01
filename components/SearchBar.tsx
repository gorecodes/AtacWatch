"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route, StopResult } from "@/lib/gtfs";
import { routeTypeInfo } from "@/lib/gtfs";
import RouteBadge from "./RouteBadge";

export default function SearchBar() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [routes, setRoutes] = useState<Route[]>([]);
  const [stops, setStops] = useState<StopResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Gestione immediata della digitazione (negli event handler il setState è ok).
  function onChange(value: string) {
    setQ(value);
    const term = value.trim();
    if (term.length < 1) {
      setRoutes([]);
      setStops([]);
      setLoading(false);
    } else {
      setLoading(true);
    }
  }

  // L'effetto fa SOLO il fetch debounced (nessun setState sincrono nel corpo).
  useEffect(() => {
    const term = q.trim();
    if (term.length < 1) return;
    let ignore = false;
    const handle = setTimeout(async () => {
      try {
        const [rRes, sRes] = await Promise.all([
          fetch(`/api/routes?q=${encodeURIComponent(term)}`),
          fetch(`/api/stops/search?q=${encodeURIComponent(term)}`),
        ]);
        const [rJson, sJson] = await Promise.all([rRes.json(), sRes.json()]);
        if (ignore) return; // una digitazione più recente ha già preso il via
        setRoutes(rJson.routes ?? []);
        setStops(sJson.stops ?? []);
      } catch {
        if (!ignore) {
          setRoutes([]);
          setStops([]);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }, 250);
    return () => {
      ignore = true;
      clearTimeout(handle);
    };
  }, [q]);

  const hasQuery = q.trim().length > 0;
  const empty = !loading && routes.length === 0 && stops.length === 0;

  return (
    <div>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500">🔍</span>
        <input
          value={q}
          onChange={(e) => onChange(e.target.value)}
          inputMode="search"
          autoComplete="off"
          placeholder="Cerca una linea o una fermata"
          className="w-full rounded-xl border border-neutral-200 bg-white py-3 pl-10 pr-4 text-base outline-none placeholder:text-neutral-400 focus:border-brand-600"
        />
      </div>
      {!hasQuery && (
        <p className="mt-1.5 px-1 text-xs text-neutral-500">
          Per linea (es. 64, A), per nome fermata o per <span className="text-neutral-400">numero di palina</span>.
        </p>
      )}

      {hasQuery && (
        <div className="mt-3 space-y-4">
          {loading && empty && <p className="px-1 text-sm text-neutral-500">Cerco…</p>}
          {empty && <p className="px-1 text-sm text-neutral-500">Nessun risultato.</p>}

          {routes.length > 0 && (
            <section>
              <h3 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Linee</h3>
              <ul className="space-y-1.5">
                {routes.map((r) => (
                  <li key={r.route_id}>
                    <button
                      onClick={() => router.push(`/line/${encodeURIComponent(r.route_id)}`)}
                      className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-left shadow-sm active:bg-neutral-100"
                    >
                      <RouteBadge shortName={r.short_name} type={r.type} color={r.color} textColor={r.text_color} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{r.long_name ?? routeTypeInfo(r.type).label}</span>
                        <span className="text-xs text-neutral-500">{routeTypeInfo(r.type).label}</span>
                      </span>
                      <span className="text-neutral-400">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {stops.length > 0 && (
            <section>
              <h3 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Fermate</h3>
              <ul className="space-y-1.5">
                {stops.map((s) => (
                  <li key={s.stop_id}>
                    <button
                      onClick={() => router.push(`/stop/${encodeURIComponent(s.stop_id)}`)}
                      className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-left shadow-sm active:bg-neutral-100"
                    >
                      <span className="text-lg">🚏</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {s.name}
                          {s.code && <span className="ml-1.5 text-xs text-neutral-500">#{s.code}</span>}
                        </span>
                        <span className="block truncate text-xs text-neutral-500">
                          {s.routes?.length ? s.routes.slice(0, 8).join(" · ") : "—"}
                        </span>
                      </span>
                      <span className="text-neutral-400">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
