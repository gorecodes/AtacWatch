"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { Route } from "@/lib/gtfs";
import { routeTypeInfo } from "@/lib/gtfs";
import { usePolling } from "@/lib/usePolling";
import RouteBadge from "./RouteBadge";

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
  const router = useRouter();
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
      <header className="flex items-center gap-3 px-4 pt-5 pb-3">
        <button onClick={() => router.back()} aria-label="Indietro" className="text-xl text-neutral-400">‹</button>
        {route && <RouteBadge shortName={route.short_name} type={route.type} color={route.color} textColor={route.text_color} size="lg" />}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{destination ? `→ ${destination}` : "Corsa"}</h1>
          <p className="text-xs text-neutral-500">
            {route ? routeTypeInfo(route.type).label : ""}
            {vehicle ? " · 🟢 in viaggio" : " · mezzo non localizzato"}
          </p>
        </div>
      </header>

      {(stops.length > 0 || vehicle) && (
        <div className="h-56 w-full bg-neutral-900">
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
          Impossibile caricare la corsa.{" "}
          <button onClick={load} className="text-sky-400 underline">Riprova</button>.
        </p>
      )}
      {loaded && !error && stops.length === 0 && (
        <p className="px-4 py-6 text-sm text-neutral-500">
          Nessuna previsione disponibile per questa corsa (potrebbe essere terminata o senza dati in tempo reale).
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
                  <span className="absolute inset-y-0 w-0.5 bg-neutral-700" style={{ top: i === 0 ? "50%" : 0, bottom: i === stops.length - 1 ? "50%" : 0 }} />
                  <span className={`z-10 mt-2 h-2.5 w-2.5 rounded-full border-2 ${isNext ? "border-emerald-400 bg-emerald-400" : passed ? "border-neutral-700 bg-neutral-700" : "border-neutral-400 bg-neutral-950"}`} />
                </span>
                <span className={`flex-1 truncate text-sm ${passed ? "text-neutral-600" : ""}`}>
                  {s.name}
                  {s.code && <span className="ml-1.5 text-xs text-neutral-500">#{s.code}</span>}
                </span>
                <span className={`w-12 text-right text-sm tabular-nums ${isNext ? "font-semibold text-emerald-400" : passed ? "text-neutral-600" : "text-neutral-300"}`}>
                  {isNext && mins != null && mins <= 0 ? "in arrivo" : hhmm(s.eta_ts)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
