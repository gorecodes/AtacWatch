"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { NearbyArrival } from "@/lib/gtfs";
import { usePolling, useNow } from "@/lib/usePolling";
import RouteBadge from "./RouteBadge";
import Eta from "./Eta";
import { PinGlyph } from "./Glyphs";
import Skeleton from "./Skeleton";

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
// In centro entro 700 metri passano decine di corse: mostrarle tutte rende la
// home infinita e niente di quello che sta sotto viene mai raggiunto.
const VISIBLE_MAX = 8;

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
  const [expanded, setExpanded] = useState(false);
  const now = useNow(15000);

  function locate(background = false) {
    if (!("geolocation" in navigator)) {
      setState({ kind: "error", msg: "Questo browser non può darmi la posizione" });
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
          msg: isTimeout ? "La rete fa finta di niente" : "Le corse non si trovano",
        };
      });
    }
  }, [coords]);

  usePolling(fetchArrivals, REFRESH_MS, [fetchArrivals]);

  return (
    <section>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-neutral-900">Vicino a te</h2>
        <div className="flex items-baseline gap-3 text-[13px]">
          {state.kind === "ok" && state.arrivals.length > 0 && (
            <div className="flex overflow-hidden rounded border border-neutral-200">
              {(["distance", "time"] as SortKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setSortBy(key)}
                  aria-pressed={sortBy === key}
                  className={`px-2 py-0.5 ${
                    sortBy === key
                      ? "bg-neutral-900 font-medium text-neutral-50"
                      : "text-neutral-500"
                  }`}
                >
                  {key === "distance" ? "Distanza" : "Attesa"}
                </button>
              ))}
            </div>
          )}
          {(state.kind === "ok" || state.kind === "loading") && (
            <button onClick={() => fetchArrivals()} className="text-neutral-500 underline decoration-neutral-300 underline-offset-2">
              Aggiorna
            </button>
          )}
        </div>
      </div>

      {state.kind === "idle" && (
        <button
          onClick={() => locate()}
          className="flex w-full items-center gap-2.5 border-y border-neutral-200 py-3 text-left active:bg-neutral-200/40"
        >
          <PinGlyph className="h-5 w-5 shrink-0 text-brand-500" />
          <span>
            <span className="block text-[15px] font-medium text-neutral-900">
              Che passa qui intorno
            </span>
            <span className="block text-[13px] text-neutral-500">
              La uso sul momento e non la salvo
            </span>
          </span>
        </button>
      )}

      {state.kind === "locating" && (
        <p className="py-3 text-[14px] text-neutral-500">Cerco dove sei…</p>
      )}

      {state.kind === "loading" && <Skeleton righe={4} />}

      {state.kind === "denied" && (
        <p className="py-3 text-[14px] text-neutral-500">
          Non ho il permesso di usare la posizione. Abilitalo nelle impostazioni del browser, poi{" "}
          <button onClick={() => locate()} className="font-medium text-brand-600 underline underline-offset-2">riprova</button>
          . Oppure cerca la fermata per nome qui sopra.
        </p>
      )}

      {state.kind === "error" && (
        <p className="py-3 text-[14px] text-neutral-500">
          {state.msg}.{" "}
          <button onClick={() => locate()} className="font-medium text-brand-600 underline underline-offset-2">Riprova</button>
        </p>
      )}

      {state.kind === "ok" && state.arrivals.length === 0 && (
        <p className="py-3 text-[14px] text-neutral-500">
          Entro 700 metri, nella prossima mezz&apos;ora, non passa nulla. Di notte e in
          periferia Roma si restringe: cerca la linea per numero.
        </p>
      )}

      {state.kind === "ok" && state.arrivals.length > 0 && (() => {
        const all = sorted(state.arrivals, sortBy);
        const shown = expanded ? all : all.slice(0, VISIBLE_MAX);
        const hidden = all.length - shown.length;
        return (
          <>
            <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
              {shown.map((a, i) => (
                <li key={`${a.route_id}-${a.direction_id}-${a.eta_ts}-${i}`}>
                  <Link
                    href={`/stop/${encodeURIComponent(a.stop_id)}`}
                    className="flex items-center gap-3 py-2.5 active:bg-neutral-200/40"
                  >
                    <RouteBadge shortName={a.short_name} color={a.color} textColor={a.text_color} />

                    <span className="min-w-0 flex-1">
                      <span className="name block truncate text-[15px] font-medium leading-snug text-neutral-900">
                        {a.headsign ?? "Destinazione non indicata"}
                      </span>
                      <span className="name block truncate text-[13px] leading-snug text-neutral-500">
                        {a.stop_name}, {a.distance_m} m
                      </span>
                    </span>

                    <Eta etaTs={a.eta_ts} isRealtime={a.is_realtime} now={now} />
                  </Link>
                </li>
              ))}
            </ul>

            {hidden > 0 && (
              <button
                onClick={() => setExpanded(true)}
                className="w-full py-2.5 text-[13px] font-medium text-neutral-600 active:text-neutral-900"
              >
                Mostra altre {hidden} corse
              </button>
            )}
          </>
        );
      })()}
    </section>
  );
}
