"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route, StopResult } from "@/lib/gtfs";
import { routeTypeInfo, routeName } from "@/lib/gtfs";
import RouteBadge from "./RouteBadge";
import { SearchGlyph, StopGlyph } from "./Glyphs";
import {
  leggiStorico,
  aggiungiStorico,
  svuotaStorico,
  type VoceStorico,
} from "@/lib/searchHistory";

export default function SearchBar() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [routes, setRoutes] = useState<Route[]>([]);
  const [stops, setStops] = useState<StopResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [storico, setStorico] = useState<VoceStorico[]>([]);
  /**
   * Lo storico compare quando si tocca il campo, come su Google e Safari: a
   * campo mai toccato la home resta pulita. Non torna mai a false, altrimenti
   * l'uscita dal campo lo nasconderebbe prima che il tocco su una voce faccia
   * effetto.
   */
  const [toccato, setToccato] = useState(false);

  function vai(voce: VoceStorico) {
    setStorico(aggiungiStorico(voce));
    router.push(
      voce.kind === "line"
        ? `/line/${encodeURIComponent(voce.id)}`
        : `/stop/${encodeURIComponent(voce.id)}`,
    );
  }

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
        <SearchGlyph className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-neutral-400" />
        <input
          value={q}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            // localStorage non esiste sul server: si legge qui, al primo tocco.
            setToccato(true);
            setStorico(leggiStorico());
          }}
          inputMode="search"
          autoComplete="off"
          placeholder="Cerca una linea o una fermata"
          className="w-full rounded border border-neutral-300 bg-neutral-50 py-2.5 pl-10 pr-3 text-[16px] outline-none placeholder:text-neutral-400 focus:border-neutral-900"
        />
      </div>
      {/* Il suggerimento su cosa si può cercare serve al primo uso; dopo, le
          ultime ricerche sono più utili e prendono il suo posto. */}
      {!hasQuery && !(toccato && storico.length > 0) && (
        <p className="mt-1.5 text-[12px] text-neutral-500">
          Numero di linea, nome della fermata o numero di palina.
        </p>
      )}

      {!hasQuery && toccato && storico.length > 0 && (
        <section className="mt-3">
          <div className="mb-1 flex items-baseline justify-between">
            <h3 className="text-[13px] font-semibold text-neutral-500">Ultime ricerche</h3>
            <button
              onClick={() => {
                svuotaStorico();
                setStorico([]);
              }}
              className="text-[13px] text-neutral-500 underline decoration-neutral-300 underline-offset-2 active:text-neutral-900"
            >
              Cancella
            </button>
          </div>
          <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
            {storico.map((v) => (
              <li key={`${v.kind}-${v.id}`}>
                <button
                  onClick={() => vai(v)}
                  className="flex w-full items-center gap-2.5 py-2.5 text-left active:bg-neutral-200/40"
                >
                  {v.kind === "line" ? (
                    <RouteBadge
                      shortName={v.shortName}
                      type={v.type}
                      color={v.color}
                      textColor={v.textColor}
                    />
                  ) : (
                    <StopGlyph className="h-5 w-5 shrink-0 text-neutral-400" />
                  )}
                  <span className="name min-w-0 flex-1 truncate text-[15px] leading-snug text-neutral-900">
                    {v.label}
                  </span>
                  {v.kind === "stop" && v.code && (
                    <span className="shrink-0 text-[12px] tabular-nums text-neutral-400">
                      {v.code}
                    </span>
                  )}
                  <span className="shrink-0 text-neutral-300">›</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasQuery && (
        <div className="mt-4 space-y-5">
          {loading && empty && <p className="text-[14px] text-neutral-500">Cerco…</p>}
          {empty && !loading && (
            <p className="text-[14px] text-neutral-500">
              Nessuna linea o fermata con questo nome.
            </p>
          )}

          {routes.length > 0 && (
            <section>
              <h3 className="mb-1 text-[13px] font-semibold text-neutral-500">Linee</h3>
              <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
                {routes.map((r) => (
                  <li key={r.route_id}>
                    <button
                      onClick={() =>
                        vai({
                          kind: "line",
                          id: r.route_id,
                          label: routeName(r.long_name, r.type),
                          shortName: r.short_name,
                          type: r.type,
                          color: r.color,
                          textColor: r.text_color,
                        })
                      }
                      className="flex w-full items-center gap-2.5 py-2.5 text-left active:bg-neutral-200/40"
                    >
                      <RouteBadge shortName={r.short_name} type={r.type} color={r.color} textColor={r.text_color} />
                      <span className="min-w-0 flex-1">
                        <span className="name block truncate text-[15px] leading-snug text-neutral-900">
                          {routeName(r.long_name, r.type)}
                        </span>
                        {r.long_name?.trim() && (
                          <span className="block text-[13px] leading-snug text-neutral-500">
                            {routeTypeInfo(r.type).label}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-neutral-300">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {stops.length > 0 && (
            <section>
              <h3 className="mb-1 text-[13px] font-semibold text-neutral-500">Fermate</h3>
              <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
                {stops.map((s) => (
                  <li key={s.stop_id}>
                    <button
                      onClick={() =>
                        vai({ kind: "stop", id: s.stop_id, label: s.name, code: s.code ?? null })
                      }
                      className="flex w-full items-center gap-2.5 py-2.5 text-left active:bg-neutral-200/40"
                    >
                      <StopGlyph className="h-5 w-5 shrink-0 text-neutral-400" />
                      <span className="min-w-0 flex-1">
                        <span className="name block truncate text-[15px] leading-snug text-neutral-900">
                          {s.name}
                        </span>
                        <span className="block truncate text-[13px] leading-snug text-neutral-500">
                          {s.code ? `palina ${s.code}` : null}
                          {s.code && s.routes?.length ? " · " : null}
                          {s.routes?.length ? s.routes.slice(0, 8).join(" ") : null}
                        </span>
                      </span>
                      <span className="shrink-0 text-neutral-300">›</span>
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
