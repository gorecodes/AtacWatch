"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { Route } from "@/lib/gtfs";
import { routeTypeInfo, minutesUntil } from "@/lib/gtfs";
import { usePolling, useNow } from "@/lib/usePolling";
import RouteBadge from "./RouteBadge";

const RouteMap = dynamic(() => import("./RouteMap"), { ssr: false });

type Direction = { direction_id: number; headsign: string | null };
type Stop = { stop_id: string; name: string; code: string | null; stop_sequence: number; lon: number; lat: number };
type StopArrival = {
  trip_id: string | null;
  headsign: string | null;
  eta_ts: string;
  minutes: number;
  is_realtime: boolean;
  delay: number | null;
};

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
}

// Distanza approssimata in metri tra due coordinate (equirettangolare)
function distM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const x = (bLon - aLon) * toRad * Math.cos(((aLat + bLat) / 2) * toRad);
  const y = (bLat - aLat) * toRad;
  return Math.sqrt(x * x + y * y) * R;
}
type LiveVehicle = {
  vehicle_id: string;
  lon: number;
  lat: number;
  bearing: number | null;
  next_stop_id: string | null;
};

const LIVE_MS = 15000;

export default function LineDetail({ routeId, initialDir = null }: { routeId: string; initialDir?: number | null }) {
  const [route, setRoute] = useState<Route | null>(null);
  const [directions, setDirections] = useState<Direction[]>([]);
  const [dir, setDir] = useState<number | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [shape, setShape] = useState<GeoJSON.LineString | null>(null);
  const [live, setLive] = useState<LiveVehicle[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [openStop, setOpenStop] = useState<string | null>(null);
  const [times, setTimes] = useState<Record<string, StopArrival[]>>({});
  const [loadingStop, setLoadingStop] = useState<string | null>(null);
  const [departures, setDepartures] = useState<StopArrival[] | null>(null);
  const now = useNow(15000);

  async function toggleStop(stopId: string) {
    if (openStop === stopId) {
      setOpenStop(null);
      return;
    }
    setOpenStop(stopId);
    if (!times[stopId]) {
      setLoadingStop(stopId);
      try {
        const res = await fetch(
          `/api/routes/${encodeURIComponent(routeId)}/arrivals?stop=${encodeURIComponent(stopId)}`,
          { cache: "no-store" },
        );
        const json = await res.json();
        setTimes((t) => ({ ...t, [stopId]: json.arrivals ?? [] }));
      } finally {
        setLoadingStop(null);
      }
    }
  }

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/routes/${encodeURIComponent(routeId)}`);
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      const json = await res.json();
      setRoute(json.route);
      const dirs: Direction[] = json.directions ?? [];
      setDirections(dirs);
      // Apri il verso passato dalla lista (es. /line/93?dir=1), se valido;
      // altrimenti il primo disponibile.
      setDir(
        initialDir != null && dirs.some((d) => d.direction_id === initialDir)
          ? initialDir
          : (dirs[0]?.direction_id ?? 0),
      );
    })();
  }, [routeId, initialDir]);

  useEffect(() => {
    if (dir == null) return;
    (async () => {
      const res = await fetch(`/api/routes/${encodeURIComponent(routeId)}/stops?dir=${dir}`);
      const json = await res.json();
      const ss: Stop[] = json.stops ?? [];
      setStops(ss);
      setShape(json.shape ?? null);
      setOpenStop(null);
      setTimes({});

      // Prossime partenze dal capolinea (prima fermata del verso)
      setDepartures(null);
      if (ss.length) {
        try {
          const r = await fetch(
            `/api/routes/${encodeURIComponent(routeId)}/arrivals?stop=${encodeURIComponent(ss[0].stop_id)}`,
            { cache: "no-store" },
          );
          const j = await r.json();
          setDepartures(j.arrivals ?? []);
        } catch {
          setDepartures([]);
        }
      }
    })();
  }, [routeId, dir]);

  // Mezzi in tempo reale per la linea/verso corrente (polling sospeso in
  // background). Al cambio di linea/verso usePolling rifà subito la fetch.
  const fetchLive = useCallback(async () => {
    if (dir == null) return;
    try {
      const res = await fetch(`/api/routes/${encodeURIComponent(routeId)}/live?dir=${dir}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setLive(json.vehicles ?? []);
    } catch {
      /* riprova al prossimo tick */
    }
  }, [routeId, dir]);

  usePolling(fetchLive, LIVE_MS, [fetchLive]);

  // stop_id -> numero di mezzi attualmente a quella fermata (la più vicina
  // alla posizione GPS del mezzo, entro 500 m). Robusto: non dipende dai trip_updates.
  const liveByStop = useMemo(() => {
    const m = new Map<string, number>();
    if (!stops.length) return m;
    for (const v of live) {
      let best: string | null = null;
      let bestD = Infinity;
      for (const s of stops) {
        const d = distM(v.lat, v.lon, s.lat, s.lon);
        if (d < bestD) {
          bestD = d;
          best = s.stop_id;
        }
      }
      if (best && bestD < 500) m.set(best, (m.get(best) ?? 0) + 1);
    }
    return m;
  }, [live, stops]);

  if (notFound) {
    return (
      <div className="mx-auto max-w-lg px-4 pt-6">
        <Link href="/" className="text-sm text-sky-400">‹ Indietro</Link>
        <p className="mt-6 text-neutral-400">Linea non trovata.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <header className="flex items-center gap-3 px-4 pt-5 pb-3">
        <Link href="/" aria-label="Torna alla home" className="text-xl text-neutral-400">‹</Link>
        {route && <RouteBadge shortName={route.short_name} type={route.type} color={route.color} textColor={route.text_color} size="lg" />}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{route?.long_name ?? (route ? routeTypeInfo(route.type).label : "…")}</h1>
          {route && <p className="text-xs text-neutral-500">{routeTypeInfo(route.type).label}</p>}
        </div>
        {live.length > 0 && (
          <span className="flex items-center gap-1 text-xs text-emerald-400">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            {live.length}
          </span>
        )}
      </header>

      {directions.length > 1 && dir != null && (
        <div className="flex gap-2 px-4 pb-3">
          {directions.map((d) => (
            <button
              key={d.direction_id}
              onClick={() => setDir(d.direction_id)}
              className={`flex-1 truncate rounded-lg border px-3 py-1.5 text-xs ${
                d.direction_id === dir
                  ? "border-sky-500 bg-sky-500/10 text-sky-300"
                  : "border-neutral-800 text-neutral-400"
              }`}
            >
              → {d.headsign ?? `Verso ${d.direction_id}`}
            </button>
          ))}
        </div>
      )}

      {stops.length > 0 && (
        <div className="flex items-center gap-2 px-4 pb-3 text-xs">
          <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-400">capolinea</span>
          <span className="truncate text-neutral-500">{stops[0].name}</span>
          <span className="shrink-0 text-neutral-600">→</span>
          <span className="truncate font-medium text-neutral-200">{stops[stops.length - 1].name}</span>
        </div>
      )}

      {stops.length > 0 && (
        <div className="px-4 pb-4">
          <p className="mb-1.5 text-sm font-semibold text-neutral-300">Prossime partenze</p>
          {departures === null ? (
            <p className="text-xs text-neutral-500">Carico gli orari…</p>
          ) : departures.length === 0 ? (
            <p className="text-xs text-neutral-500">Nessuna partenza nelle prossime 2 ore.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {departures.slice(0, 8).map((d, i) => (
                <span
                  key={`${d.eta_ts}-${i}`}
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm tabular-nums ${
                    d.is_realtime ? "bg-emerald-500/15 text-emerald-300" : "bg-neutral-800 text-neutral-300"
                  }`}
                  title={d.is_realtime ? "tempo reale" : "orario programmato"}
                >
                  {hhmm(d.eta_ts)}
                  {d.is_realtime && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="h-64 w-full bg-neutral-900">
        <RouteMap shape={shape} stops={stops} vehicles={live} color={route?.color} />
      </div>

      <ul className="px-4 py-3">
        {stops.map((s, i) => {
          const here = liveByStop.get(s.stop_id) ?? 0;
          const open = openStop === s.stop_id;
          const stopTimes = times[s.stop_id];
          return (
            <li key={`${s.stop_id}-${s.stop_sequence}`}>
              <div className="flex items-center gap-3 py-2">
                <span className="relative flex w-4 justify-center self-stretch">
                  <span className="absolute inset-y-0 w-0.5 bg-neutral-700" style={{ top: i === 0 ? "50%" : 0, bottom: i === stops.length - 1 ? "50%" : 0 }} />
                  <span className={`z-10 mt-2 h-2.5 w-2.5 rounded-full border-2 ${here > 0 ? "border-emerald-400 bg-emerald-400" : "border-neutral-400 bg-neutral-950"}`} />
                </span>
                <Link href={`/stop/${encodeURIComponent(s.stop_id)}`} className="min-w-0 flex-1 truncate text-sm active:opacity-70">
                  {s.name}
                  {s.code && <span className="ml-1.5 text-xs text-neutral-500">#{s.code}</span>}
                </Link>
                {here > 0 && (
                  <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">
                    🚌 qui{here > 1 ? ` ×${here}` : ""}
                  </span>
                )}
                <button
                  onClick={() => toggleStop(s.stop_id)}
                  className={`shrink-0 rounded-md border px-2 py-1 text-xs ${open ? "border-sky-500 text-sky-300" : "border-neutral-700 text-neutral-400"}`}
                >
                  orari {open ? "▴" : "▾"}
                </button>
              </div>

              {open && (
                <div className="ml-7 mb-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
                  {loadingStop === s.stop_id && !stopTimes && (
                    <p className="text-xs text-neutral-500">Carico gli orari…</p>
                  )}
                  {stopTimes && stopTimes.length === 0 && (
                    <p className="text-xs text-neutral-500">Nessun passaggio nelle prossime 2 ore.</p>
                  )}
                  {stopTimes && stopTimes.length > 0 && (
                    <ul className="space-y-1.5">
                      {stopTimes.slice(0, 3).map((a, k) => {
                        const inner = (
                          <div className="flex items-center gap-2 text-sm">
                            <span className="tabular-nums">{hhmm(a.eta_ts)}</span>
                            {a.is_realtime ? (
                              <span className="flex items-center gap-1 text-xs text-emerald-400">
                                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                                tempo reale
                              </span>
                            ) : (
                              <span className="text-xs text-neutral-500">🕐 programmato</span>
                            )}
                            <span className="ml-auto text-xs text-neutral-400">
                              {minutesUntil(a.eta_ts, now) <= 0 ? "in arrivo" : `tra ${minutesUntil(a.eta_ts, now)} min`}
                            </span>
                          </div>
                        );
                        return (
                          <li key={`${a.trip_id ?? "sched"}-${a.eta_ts}-${k}`}>
                            {a.trip_id ? (
                              <Link href={`/trip/${encodeURIComponent(a.trip_id)}`} className="block active:opacity-70">
                                {inner}
                              </Link>
                            ) : (
                              inner
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {stops.length === 0 && <li className="py-6 text-center text-sm text-neutral-500">Nessuna fermata.</li>}
      </ul>
    </div>
  );
}
