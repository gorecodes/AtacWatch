"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import type { Arrival } from "@/lib/gtfs";
import { minutesUntil } from "@/lib/gtfs";
import { usePolling, useNow } from "@/lib/usePolling";
import { useFavorites } from "@/lib/favorites";
import RouteBadge from "./RouteBadge";
import Eta from "./Eta";
import { StarGlyph } from "./Glyphs";
import BackButton from "./BackButton";
import BellButton from "./BellButton";
import { AlertGlyph } from "./Glyphs";
import { useAvvisi, avvisiPerLinea } from "@/lib/useAvvisi";
import HeaderActions from "./HeaderActions";
import Skeleton from "./Skeleton";

type StopInfo = { stop_id: string; name: string; code: string | null } | null;
const REFRESH_MS = 15000;

export default function ArrivalsList({ stopId }: { stopId: string }) {
  const [stop, setStop] = useState<StopInfo>(null);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const { isFavorite, toggle } = useFavorites();
  const now = useNow(15000);
  // Avvisi della fermata, indicizzati per nome di linea: servono a marcare le
  // righe, non a riempire un riquadro.
  const perLinea = avvisiPerLinea(useAvvisi({ stopId }));
  const [apertoId, setApertoId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/stops/${encodeURIComponent(stopId)}/arrivals`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setStop(json.stop ?? null);
      setArrivals(json.arrivals ?? []);
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
            <HeaderActions />
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

          // L'avviso sta sulla RIGA della linea, non in un riquadro in cima:
          // così non serve dire a quale linea si riferisce, si vede. E niente
          // banda di colore prima del dato per cui l'utente ha aperto l'app.
          const suoiAvvisi = perLinea.get(a.short_name);
          const chiave = `${a.route_id}-${a.direction_id}-${a.eta_ts}-${i}`;
          const avvisoAperto = apertoId === chiave;

          return (
            // Il colore della riga lo usiamo SOLO quando l'avviso è aperto:
            // dice quale riga stai leggendo, e sparisce appena chiudi. Tingere
            // stabilmente le righe con avviso invece andava addosso al colore
            // dell'ETA, che distingue il tracciato dal previsto ed è il dato
            // più importante della lista.
            <li
              key={chiave}
              className={avvisoAperto ? "-mx-2 rounded bg-amber-50/70 px-2" : undefined}
            >
              {/* Il triangolo sta a SINISTRA, subito dopo il numero della
                  linea. Prima era a destra accanto alla campanella: due
                  bersagli da tocco adiacenti sono il modo di far sbagliare il
                  dito, e la riga sembrava piena. Ai due capi opposti si
                  toccano senza pensarci, e accanto al numero è anche il posto
                  logico — l'avviso riguarda quella linea.
                  Due Link allo stesso indirizzo perché il triangolo in mezzo
                  è interattivo e non può stare dentro un'ancora. */}
              <div className="flex items-center">
                <Link href={href} className="shrink-0 py-2.5 pr-2.5 active:opacity-60">
                  <RouteBadge shortName={a.short_name} color={a.color} textColor={a.text_color} />
                </Link>

                {suoiAvvisi && (
                  <button
                    onClick={() => setApertoId(avvisoAperto ? null : chiave)}
                    aria-expanded={avvisoAperto}
                    aria-label={`Avviso di servizio sulla linea ${a.short_name}`}
                    className={`-ml-1 flex h-11 w-7 shrink-0 items-center justify-center ${
                      avvisoAperto ? "text-amber-800" : "text-amber-600"
                    }`}
                  >
                    <AlertGlyph className="h-[15px] w-[15px]" />
                  </button>
                )}

                <Link href={href} className="flex min-w-0 flex-1 items-center gap-2.5 py-2.5 active:bg-neutral-200/40">
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
              </div>

              {avvisoAperto && suoiAvvisi && (
                <div className="pb-2.5 pr-2">
                  {suoiAvvisi.map((av) => (
                    <div key={av.id} className="border-l-2 border-amber-400 pl-2.5">
                      <p className="text-[12px] font-semibold leading-snug text-amber-700">
                        {/* Stesso scrupolo del riquadro: sappiamo che la linea è
                            coinvolta, non che lo sia questa fermata, tranne nei
                            3 avvisi su 181 in cui ATAC dichiara gli stop_ids. */}
                        {av.toccaQui
                          ? `${av.effetto} qui`
                          : `${av.effetto} su un tratto del percorso`}
                        {av.causa && ` · ${av.causa}`}
                        {av.quando && ` · ${av.quando}`}
                      </p>
                      <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-600">
                        {av.titolo}
                      </p>
                      {av.dettaglio && (
                        <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-500">
                          {av.dettaglio}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
