"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import type { Arrival } from "@/lib/gtfs";
import { minutesUntil } from "@/lib/gtfs";
import { usePolling, useNow } from "@/lib/usePolling";
import { useFavorites } from "@/lib/favorites";
import RouteBadge from "./RouteBadge";
import Eta from "./Eta";
import { StarGlyph, LiveBeacon } from "./Glyphs";
import BackButton from "./BackButton";
import BellButton from "./BellButton";
import ThemeToggle from "./ThemeToggle";
import Skeleton from "./Skeleton";

type StopInfo = { stop_id: string; name: string; code: string | null } | null;
const REFRESH_MS = 15000;

export default function ArrivalsList({ stopId }: { stopId: string }) {
  const [stop, setStop] = useState<StopInfo>(null);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const { isFavorite, toggle } = useFavorites();
  const now = useNow(15000);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/stops/${encodeURIComponent(stopId)}/arrivals`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setStop(json.stop ?? null);
      setArrivals(json.arrivals ?? []);
      setUpdatedAt(new Date());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [stopId]);

  usePolling(load, REFRESH_MS, [load]);

  const starred = stop ? isFavorite(stopId) : false;

  return (
    <div className="mx-auto max-w-lg">
      {/* Intestazione chiara come le altre pagine. La fascia scura c'era per
          richiamare l'insegna fisica della fermata, ma con la barra di
          navigazione in basso le due masse scure si pesavano a vicenda. Il
          numero di palina resta in evidenza: è come i romani identificano una
          fermata, quindi è un dato e non un dettaglio tecnico. */}
      <header className="px-4 pb-1 pt-4">
        <div className="mb-2.5 flex items-center justify-between">
          <BackButton />

          <div className="flex items-center gap-3">
            {/* Il LiveBeacon segnala che la pagina si aggiorna: l'orario esatto
                dell'ultimo aggiornamento del feed ATAC è nella striscia globale
                sopra la navigazione (FeedStatus), che è più accurato del
                timestamp del browser. */}
            {updatedAt && !error && <LiveBeacon />}
            {stop && (
              <button
                onClick={() => toggle({ stop_id: stopId, name: stop.name, code: stop.code ?? null })}
                aria-pressed={starred}
                aria-label={starred ? "Rimuovi dai preferiti" : "Salva nei preferiti"}
                className={`flex h-11 w-11 items-center justify-center rounded-full ${
                  starred ? "text-brand-500 active:bg-brand-50" : "text-neutral-400 active:bg-neutral-200/60"
                }`}
              >
                <StarGlyph filled={starred} className="h-6 w-6" />
              </button>
            )}
            {/* Ultimo a destra, come su ogni pagina: la stella riguarda questa
                fermata, il tema riguarda l'app, e l'ordine tiene separate le
                due cose. */}
            <ThemeToggle />
          </div>
        </div>

        <h1 className="name text-[27px] font-bold leading-[1.05] tracking-tight text-neutral-900">
          {stop?.name ?? "Fermata"}
        </h1>
        {stop?.code && (
          <p className="mt-0.5 text-[13px] tabular-nums text-neutral-500">palina {stop.code}</p>
        )}
      </header>

      {/* La legenda una volta sola, invece di ripetere "tempo reale" /
          "orario programmato" su ogni riga: quella seconda riga raddoppiava
          l'altezza e dimezzava gli arrivi visibili. */}
      {arrivals.length > 0 && (
        <p className="px-4 pb-1 pt-2.5 text-[12px] text-neutral-500">
          In verde i mezzi tracciati in tempo reale, in grigio l&apos;orario previsto.
        </p>
      )}

      {loading && arrivals.length === 0 && <Skeleton righe={5} className="px-4" />}
      {error && arrivals.length === 0 && (
        <p className="px-4 py-6 text-[14px] text-neutral-500">
          Gli arrivi non arrivano.{" "}
          <button onClick={load} className="font-medium text-brand-600 underline underline-offset-2">Riprova</button>
        </p>
      )}
      {!loading && !error && arrivals.length === 0 && (
        <p className="px-4 py-6 text-[14px] text-neutral-500">
          Niente. Il vuoto. Guardo 90 minuti avanti e non trovo nulla —
          più in là non so.
        </p>
      )}

      <ul className="divide-y divide-neutral-200 px-4">
        {arrivals.map((a, i) => {
          const href = a.trip_id
            ? `/trip/${encodeURIComponent(a.trip_id)}`
            : a.direction_id != null
              ? `/line/${encodeURIComponent(a.route_id)}?dir=${a.direction_id}`
              : `/line/${encodeURIComponent(a.route_id)}`;
          // La campanella sparisce quando restano 3 minuti o meno: sotto quella
          // soglia la notifica arriverebbe quando il bus è già a 2 minuti (il
          // worker ha fino a 60s di latenza, e `now` si aggiorna ogni 15s).
          // La soglia è > 3, cioè visibile da 4 minuti in su.
          const minsLeft = minutesUntil(a.eta_ts, now);
          const bellUtile = a.trip_id != null && minsLeft > 3;
          return (
            <li key={`${a.route_id}-${a.direction_id}-${a.eta_ts}-${i}`} className="flex items-center">
              <Link href={href} className="flex min-w-0 flex-1 items-center gap-2.5 py-2.5 active:bg-neutral-200/40">
                <RouteBadge shortName={a.short_name} color={a.color} textColor={a.text_color} />

                <span className="name min-w-0 flex-1 truncate text-[15px] leading-snug text-neutral-900">
                  {a.headsign ?? "Destinazione non indicata"}
                </span>

                <Eta etaTs={a.eta_ts} isRealtime={a.is_realtime} now={now} />
              </Link>

              {bellUtile && (
                <BellButton
                  stopId={stopId}
                  tripId={a.trip_id!}
                  routeShortName={a.short_name}
                  headsign={a.headsign ?? null}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
