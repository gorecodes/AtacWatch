"use client";

import { useEffect, useRef, useState } from "react";
import { SearchGlyph, StopGlyph, PinGlyph, CloseGlyph, RouteGlyph } from "./Glyphs";

/**
 * Un capo del viaggio: la posizione attuale, una fermata, o un indirizzo.
 *
 * La ricerca interroga /api/geocode, che unisce le fermate del GTFS e i luoghi
 * di OpenStreetMap: per chi cerca sono la stessa cosa, "dove voglio andare".
 */
export type Endpoint =
  | { kind: "gps"; lat: number; lon: number }
  | { kind: "stop"; stopId: string; name: string }
  | { kind: "place"; lat: number; lon: number; name: string };

type Risultato = {
  kind: "stop" | "street" | "address" | "poi";
  id: string;
  label: string;
  detail: string | null;
  stopId: string | null;
  lat: number | null;
  lon: number | null;
};

export default function PlanEndpoint({
  label,
  value,
  onChange,
  allowGps,
}: {
  label: string;
  value: Endpoint | null;
  onChange: (e: Endpoint | null) => void;
  allowGps: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Risultato[]>([]);
  const [open, setOpen] = useState(false);
  const [gpsState, setGpsState] = useState<"idle" | "locating" | "denied">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 3) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        setResults((json.results ?? []).slice(0, 8));
      } catch {
        setResults([]);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  function useGps() {
    if (!("geolocation" in navigator)) return;
    setGpsState("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsState("idle");
        onChange({ kind: "gps", lat: pos.coords.latitude, lon: pos.coords.longitude });
        setOpen(false);
      },
      () => setGpsState("denied"),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }

  if (value && !open) {
    return (
      <div className="flex items-center gap-2 border-b border-neutral-300 py-2.5">
        <span className="w-[68px] shrink-0 text-[12px] uppercase tracking-wide text-neutral-500">{label}</span>
        {value.kind === "gps" ? (
          <PinGlyph className="h-4 w-4 shrink-0 text-brand-500" />
        ) : value.kind === "stop" ? (
          <StopGlyph className="h-4 w-4 shrink-0 text-neutral-500" />
        ) : (
          <RouteGlyph className="h-4 w-4 shrink-0 text-neutral-500" />
        )}
        <span className="name min-w-0 flex-1 truncate text-[15px] text-neutral-900">
          {value.kind === "gps" ? "La mia posizione" : value.name}
        </span>
        <button
          onClick={() => {
            onChange(null);
            setQ("");
            setOpen(true);
          }}
          aria-label="Cambia"
          className="shrink-0 rounded p-1 text-neutral-400 active:text-neutral-700"
        >
          <CloseGlyph className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-neutral-300 py-2">
      <div className="flex items-center gap-2">
        <span className="w-[68px] shrink-0 text-[12px] uppercase tracking-wide text-neutral-500">{label}</span>
        <SearchGlyph className="h-4 w-4 shrink-0 text-neutral-400" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Via, fermata o luogo"
          className="min-w-0 flex-1 bg-transparent py-1 text-[15px] text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
        />
      </div>

      {allowGps && (
        <button
          onClick={useGps}
          className="mt-1 flex items-center gap-2 pl-[78px] text-[13px] text-neutral-600 active:text-neutral-900"
        >
          <PinGlyph className="h-4 w-4 text-brand-500" />
          {gpsState === "locating" ? "Cerco dove sei…" : gpsState === "denied" ? "Permesso negato" : "Usa la mia posizione"}
        </button>
      )}

      {results.length > 0 && (
        <ul className="mt-1 divide-y divide-neutral-200">
          {results.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => {
                  if (r.kind === "stop" && r.stopId) {
                    onChange({ kind: "stop", stopId: r.stopId, name: r.label });
                  } else if (r.lat != null && r.lon != null) {
                    onChange({ kind: "place", lat: r.lat, lon: r.lon, name: r.label });
                  }
                  setOpen(false);
                  setQ("");
                }}
                className="flex w-full items-center gap-2 py-2 text-left active:bg-neutral-200/40"
              >
                {r.kind === "stop" ? (
                  <StopGlyph className="h-4 w-4 shrink-0 text-neutral-400" />
                ) : (
                  <RouteGlyph className="h-4 w-4 shrink-0 text-neutral-400" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="name block truncate text-[14px] text-neutral-900">{r.label}</span>
                  {r.detail && (
                    <span className="name block truncate text-[12px] text-neutral-500">{r.detail}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
