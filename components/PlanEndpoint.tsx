"use client";

import { useEffect, useRef, useState } from "react";
import type { StopResult } from "@/lib/gtfs";
import { SearchGlyph, StopGlyph, PinGlyph, CloseGlyph } from "./Glyphs";

/**
 * Un capo del viaggio: la posizione attuale oppure una fermata cercata.
 *
 * Non si può digitare un indirizzo perché non abbiamo un geocoder: il feed
 * GTFS conosce le fermate, non le vie. È il limite principale di questa
 * versione del calcolo percorsi.
 */
export type Endpoint =
  | { kind: "gps"; lat: number; lon: number }
  | { kind: "stop"; stopId: string; name: string };

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
  const [results, setResults] = useState<StopResult[]>([]);
  const [open, setOpen] = useState(false);
  const [gpsState, setGpsState] = useState<"idle" | "locating" | "denied">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/stops/search?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        setResults((json.stops ?? []).slice(0, 6));
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
        ) : (
          <StopGlyph className="h-4 w-4 shrink-0 text-neutral-500" />
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
          placeholder="Cerca una fermata"
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
          {results.map((s) => (
            <li key={s.stop_id}>
              <button
                onClick={() => {
                  onChange({ kind: "stop", stopId: s.stop_id, name: s.name });
                  setOpen(false);
                  setQ("");
                }}
                className="flex w-full items-center gap-2 py-2 text-left active:bg-neutral-200/40"
              >
                <StopGlyph className="h-4 w-4 shrink-0 text-neutral-400" />
                <span className="name min-w-0 flex-1 truncate text-[14px] text-neutral-900">{s.name}</span>
                {s.code && <span className="shrink-0 text-[12px] tabular-nums text-neutral-400">{s.code}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
