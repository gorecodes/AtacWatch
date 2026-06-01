"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { NearbyArrival } from "@/lib/gtfs";
import { etaLabel, minutesUntil } from "@/lib/gtfs";
import { usePolling, useNow } from "@/lib/usePolling";
import RouteBadge from "./RouteBadge";

type Coords = { lat: number; lon: number };
type State =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading"; coords: Coords }
  | { kind: "denied" }
  | { kind: "error"; msg: string }
  | { kind: "ok"; coords: Coords; arrivals: NearbyArrival[] };

type SortKey = "distance" | "time";

const REFRESH_MS = 30_000;
const COORDS_KEY = "nearbyArrivals_coords";

function saveCoords(c: Coords) {
  try { sessionStorage.setItem(COORDS_KEY, JSON.stringify(c)); } catch {}
}
function loadCoords(): Coords | null {
  try { return JSON.parse(sessionStorage.getItem(COORDS_KEY) ?? "null"); } catch { return null; }
}

function sorted(arrivals: NearbyArrival[], by: SortKey): NearbyArrival[] {
  return [...arrivals].sort((a, b) =>
    by === "distance"
      ? a.distance_m - b.distance_m || a.minutes - b.minutes
      : a.minutes - b.minutes || a.distance_m - b.distance_m,
  );
}

export default function NearbyArrivals() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [sortBy, setSortBy] = useState<SortKey>("distance");
  const now = useNow(15000);

  function locate(background = false) {
    if (!("geolocation" in navigator)) {
      setState({ kind: "error", msg: "Geolocalizzazione non disponibile" });
      return;
    }
    if (!background) setState({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        saveCoords(coords);
        setState((prev) =>
          // In background: aggiorna le coordinate senza resettare i dati
          prev.kind === "ok"
            ? { ...prev, coords }
            : { kind: "loading", coords },
        );
      },
      (err) => {
        if (background) return; // ignora errori in background, mantieni dati
        setState(err.code === err.PERMISSION_DENIED
          ? { kind: "denied" }
          : { kind: "error", msg: err.message });
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 5 * 60_000 },
    );
  }

  // Al mount: usa subito le coords dell'ultima sessione (se presenti), poi
  // aggiorna la posizione in background. Se non ci sono coords salvate,
  // avvia la localizzazione completa solo se il permesso è già concesso.
  useEffect(() => {
    const saved = loadCoords();
    if (saved) {
      setState({ kind: "loading", coords: saved });
      locate(true); // aggiorna in background
      return;
    }
    if (!("permissions" in navigator)) return;
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((s) => { if (s.state === "granted") locate(); })
      .catch(() => {});
  }, []);

  const coords = state.kind === "loading" || state.kind === "ok" ? state.coords : null;

  const fetchArrivals = useCallback(async (attempt = 1) => {
    if (!coords) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(
        `/api/nearby/arrivals?lat=${coords.lat}&lon=${coords.lon}`,
        { cache: "no-store", signal: controller.signal },
      );
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setState({ kind: "ok", coords, arrivals: json.arrivals ?? [] });
    } catch (err) {
      clearTimeout(timer);
      setState((prev) => {
        if (prev.kind === "ok") return prev; // mantieni dati precedenti sul refresh
        // Primo caricamento fallito: riprova una volta in automatico
        if (attempt < 2) {
          setTimeout(() => fetchArrivals(attempt + 1), 2000);
          return prev; // rimani in "loading" durante il retry
        }
        const isTimeout = err instanceof Error && err.name === "AbortError";
        return {
          kind: "error",
          msg: isTimeout ? "Timeout — rete lenta?" : "Errore nel recupero delle corse",
        };
      });
    }
  }, [coords]);

  usePolling(fetchArrivals, REFRESH_MS, [fetchArrivals]);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-400">Corse vicine</h2>
        <div className="flex items-center gap-2">
          {state.kind === "ok" && (
            <div className="flex rounded-lg border border-neutral-800 text-xs">
              {(["distance", "time"] as SortKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setSortBy(key)}
                  className={`px-2 py-0.5 ${
                    sortBy === key
                      ? "bg-neutral-700 text-neutral-100"
                      : "text-neutral-500"
                  } first:rounded-l-lg last:rounded-r-lg`}
                >
                  {key === "distance" ? "Vicino" : "Orario"}
                </button>
              ))}
            </div>
          )}
          {(state.kind === "ok" || state.kind === "loading") && (
            <button onClick={() => fetchArrivals()} className="text-xs text-sky-400 active:text-sky-300">
              Aggiorna
            </button>
          )}
        </div>
      </div>

      {state.kind === "idle" && (
        <button
          onClick={() => locate()}
          className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-left text-sm text-neutral-300 active:bg-neutral-800"
        >
          📍 Mostra le corse vicine a me
        </button>
      )}

      {state.kind === "locating" && (
        <p className="text-sm text-neutral-500">Cerco la tua posizione…</p>
      )}

      {(state.kind === "loading") && (
        <p className="text-sm text-neutral-500">Carico le corse vicine…</p>
      )}

      {state.kind === "denied" && (
        <p className="text-sm text-neutral-500">
          Posizione negata. Abilita la geolocalizzazione e{" "}
          <button onClick={() => locate()} className="text-sky-400 underline">riprova</button>.
        </p>
      )}

      {state.kind === "error" && (
        <p className="text-sm text-neutral-500">
          {state.msg}.{" "}
          <button onClick={() => locate()} className="text-sky-400 underline">Riprova</button>.
        </p>
      )}

      {state.kind === "ok" && state.arrivals.length === 0 && (
        <p className="text-sm text-neutral-500">
          Nessuna corsa nei prossimi 30 minuti nel raggio di 700 m.
        </p>
      )}

      {state.kind === "ok" && state.arrivals.length > 0 && (
        <ul className="space-y-1.5">
          {sorted(state.arrivals, sortBy).map((a, i) => {
            const href = `/stop/${encodeURIComponent(a.stop_id)}`;
            return (
              <li key={`${a.route_id}-${a.direction_id}-${a.eta_ts}-${i}`}>
                <Link
                  href={href}
                  className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 active:bg-neutral-800"
                >
                  <RouteBadge shortName={a.short_name} />

                  {/* verso + fermata */}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      → {a.headsign ?? "—"}
                    </span>
                    <span className="block truncate text-xs text-neutral-500">
                      {a.stop_name}
                      {a.stop_code && (
                        <span className="ml-1 text-neutral-600">#{a.stop_code}</span>
                      )}
                      <span className="mx-1 text-neutral-700">·</span>
                      {a.distance_m} m
                    </span>
                  </span>

                  {/* ETA */}
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <span
                      className={`text-base font-semibold tabular-nums ${
                        a.is_realtime ? "text-emerald-400" : "text-neutral-200"
                      }`}
                    >
                      {etaLabel(minutesUntil(a.eta_ts, now))}
                    </span>
                    {a.is_realtime && (
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
