"use client";

import BackButton from "./BackButton";
import { useCallback, useState } from "react";
import Link from "next/link";

import dynamic from "next/dynamic";
import type { Route } from "@/lib/gtfs";
import { routeTypeInfo } from "@/lib/gtfs";
import { usePolling } from "@/lib/usePolling";
import RouteBadge from "./RouteBadge";
import { LiveBeacon } from "./Glyphs";

const RouteMap = dynamic(() => import("./RouteMap"), { ssr: false });

type TripStop = {
  stop_id: string;
  name: string;
  code: string | null;
  stop_sequence: number;
  eta_ts: string | null;
  delay: number | null;
  lon: number;
  lat: number;
};
type Vehicle = { vehicle_id: string; lon: number; lat: number; bearing: number | null } | null;

const REFRESH_MS = 15000;

function hhmm(iso: string | null): string {
  if (!iso) return "--:--";
  return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
}
function minutesTo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - Date.now()) / 60000);
}

export default function TripDetail({ tripId }: { tripId: string }) {
  const [route, setRoute] = useState<Route | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle>(null);
  const [stops, setStops] = useState<TripStop[]>([]);
  const [headsign, setHeadsign] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${encodeURIComponent(tripId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRoute(json.route ?? null);
      setVehicle(json.vehicle ?? null);
      setStops(json.stops ?? []);
      setHeadsign(json.headsign ?? null);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoaded(true);
    }
  }, [tripId]);

  usePolling(load, REFRESH_MS, [load]);

  // Destinazione = headsign della corsa (quello sul bus); l'ultima fermata nota
  // in trip_updates è solo un fallback (può essere intermedia).
  const destination = headsign ?? (stops.length ? stops[stops.length - 1].name : null);
  const nextIdx = stops.findIndex((s) => (minutesTo(s.eta_ts) ?? -1) >= 0);

  return (
    <div className="mx-auto max-w-lg">
      {/* Chiara come la pagina linea: la fascia scura è riservata alla fermata. */}
      <header className="px-4 pb-1 pt-4">
        <div className="mb-3 flex items-center justify-between">
          <BackButton />
          <span className="flex items-center gap-1.5 text-[12px] text-neutral-500">
            {vehicle ? (
              <>
                <LiveBeacon />
                Mezzo localizzato
              </>
            ) : (
              "Mezzo fantasma"
            )}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {route && <RouteBadge shortName={route.short_name} type={route.type} color={route.color} textColor={route.text_color} size="lg" />}
          <div className="min-w-0 flex-1">
            <h1 className="name truncate text-[19px] font-semibold leading-tight text-neutral-900">
              {destination ?? "Corsa"}
            </h1>
            {route && <p className="text-[13px] text-neutral-500">{routeTypeInfo(route.type).label}</p>}
          </div>
        </div>
      </header>

      {(stops.length > 0 || vehicle) && (
        <div className="h-56 w-full bg-neutral-100">
          <RouteMap
            shape={null}
            stops={stops}
            vehicles={vehicle ? [vehicle] : []}
            color={route?.color}
          />
        </div>
      )}

      {loaded && error && stops.length === 0 && (
        <p className="px-4 py-6 text-sm text-neutral-500">
          La corsa non si lascia caricare.{" "}
          <button onClick={load} className="text-brand-600 underline">Riprova</button>.
        </p>
      )}
      {loaded && !error && stops.length === 0 && (
        <p className="px-4 py-6 text-sm text-neutral-500">
          Di questa corsa non si sa più niente. Forse è già finita.
        </p>
      )}

      <ul className="px-4 py-3">
        {stops.map((s, i) => {
          const mins = minutesTo(s.eta_ts);
          const isNext = i === nextIdx;
          const passed = mins != null && mins < 0;
          return (
            <li key={`${s.stop_id}-${s.stop_sequence}`}>
              <Link href={`/stop/${encodeURIComponent(s.stop_id)}`} className="flex items-center gap-3 py-2 active:opacity-70">
                <span className="relative flex w-4 justify-center">
                  <span className="absolute inset-y-0 w-0.5 bg-neutral-300" style={{ top: i === 0 ? "50%" : 0, bottom: i === stops.length - 1 ? "50%" : 0 }} />
                  <span className={`z-10 mt-2 h-2.5 w-2.5 rounded-full border-2 ${isNext ? "border-live-500 bg-live-500" : passed ? "border-neutral-300 bg-neutral-300" : "border-neutral-400 bg-neutral-50"}`} />
                </span>
                <span className={`name min-w-0 flex-1 truncate text-[15px] ${passed ? "text-neutral-400" : "text-neutral-900"}`}>
                  {s.name}
                </span>
                <span className={`w-[68px] shrink-0 text-right tabular-nums ${isNext ? "font-semibold text-live-600" : passed ? "text-neutral-400" : "text-neutral-700"}`}>
                  {isNext && mins != null && mins <= 0
                    ? <span className="text-[13px]">in arrivo</span>
                    : <span className="text-[15px]">{hhmm(s.eta_ts)}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
