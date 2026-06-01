"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { NearbyStop } from "@/lib/gtfs";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "error"; msg: string }
  | { kind: "ok"; stops: NearbyStop[] };

export default function NearbyStops() {
  const [state, setState] = useState<State>({ kind: "idle" });

  function locate() {
    if (!("geolocation" in navigator)) {
      setState({ kind: "error", msg: "Geolocalizzazione non disponibile" });
      return;
    }
    setState({ kind: "loading" });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(`/api/stops/nearby?lat=${latitude}&lon=${longitude}&r=700`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          setState({ kind: "ok", stops: json.stops ?? [] });
        } catch {
          setState({ kind: "error", msg: "Errore nel recupero delle fermate" });
        }
      },
      (err) => {
        setState(err.code === err.PERMISSION_DENIED ? { kind: "denied" } : { kind: "error", msg: err.message });
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }

  // Geolocalizza in automatico SOLO se il permesso è già stato concesso, così
  // non si forza il prompt GPS a freddo alla prima visita (privacy/UX).
  useEffect(() => {
    if (!("permissions" in navigator)) return;
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((status) => {
        if (status.state === "granted") locate();
      })
      .catch(() => {});
  }, []);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-400">Fermate vicine</h2>
        <button onClick={locate} className="text-xs text-sky-400 active:text-sky-300">
          Aggiorna
        </button>
      </div>

      {state.kind === "idle" && (
        <button
          onClick={locate}
          className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-left text-sm text-neutral-300 active:bg-neutral-800"
        >
          📍 Mostra le fermate vicine a me
        </button>
      )}
      {state.kind === "loading" && <p className="text-sm text-neutral-500">Cerco la tua posizione…</p>}
      {state.kind === "denied" && (
        <p className="text-sm text-neutral-500">
          Posizione negata. Abilita la geolocalizzazione e{" "}
          <button onClick={locate} className="text-sky-400 underline">riprova</button>.
        </p>
      )}
      {state.kind === "error" && <p className="text-sm text-neutral-500">{state.msg}</p>}
      {state.kind === "ok" && state.stops.length === 0 && (
        <p className="text-sm text-neutral-500">Nessuna fermata nel raggio di 700 m.</p>
      )}

      {state.kind === "ok" && state.stops.length > 0 && (
        <ul className="space-y-1.5">
          {state.stops.map((s) => (
            <li key={s.stop_id}>
              <Link
                href={`/stop/${encodeURIComponent(s.stop_id)}`}
                className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 active:bg-neutral-800"
              >
                <span className="text-lg">🚏</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {s.name}
                    {s.code && <span className="ml-1.5 text-xs font-normal text-neutral-500">#{s.code}</span>}
                  </span>
                  <span className="block truncate text-xs text-neutral-500">
                    {s.routes?.length ? s.routes.slice(0, 8).join(" · ") : "—"}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-neutral-500">{s.distance_m} m</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
