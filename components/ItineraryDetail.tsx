"use client";

import Link from "next/link";
import RouteBadge from "./RouteBadge";
import { BackGlyph } from "./Glyphs";
import { oraLocale as ora, type OpzioneItinerario, type TrattaItinerario } from "@/lib/itinerario";

/**
 * Il percorso scelto, a pagina intera.
 *
 * Prima il dettaglio stava SOTTO l'elenco delle proposte: con quattro o cinque
 * itinerari finiva oltre la piega, e chi non scorreva non lo vedeva mai. Ora
 * sostituisce l'elenco e ci si torna col tasto indietro, che è anche il gesto
 * di sistema su Android.
 */
export default function ItineraryDetail({
  opzione,
  walkOption,
  onBack,
}: {
  opzione: OpzioneItinerario;
  walkOption: { minutes: number; meters: number } | null;
  onBack: () => void;
}) {
  return (
    <section>
      <button
        onClick={onBack}
        className="-ml-2 mb-2 flex h-11 items-center gap-1 rounded-full px-2.5 text-neutral-500 active:text-neutral-900"
      >
        <BackGlyph className="h-4 w-4" />
        <span className="text-[13px]">Tutti i percorsi</span>
      </button>

      <div className="flex items-baseline justify-between border-b border-neutral-300 pb-2">
        {/* Gli orari sono di una corsa d'esempio: il percorso vale a
            prescindere, e dirlo evita che sembrino "la" partenza. */}
        <p className="text-[19px] font-bold tabular-nums text-neutral-900">
          {ora(opzione.departAt)} → {ora(opzione.arriveAt)}
          {opzione.esempio && (
            <span className="ml-1.5 align-middle text-[12px] font-normal tabular-nums text-neutral-500">
              es.
            </span>
          )}
        </p>
        <p className="text-right text-[13px] text-neutral-600">
          {opzione.durationMin} min di viaggio
          <br />
          {opzione.walkMin} a piedi
        </p>
      </div>

      <ol className="divide-y divide-neutral-200">
        {opzione.legs.map((leg: TrattaItinerario, i: number) => (
          <li key={i} className="flex gap-3 py-3">
            {leg.kind === "walk" ? (
              <>
                <span className="w-[52px] shrink-0 text-[12px] uppercase tracking-wide text-neutral-500">
                  a piedi
                </span>
                <span className="min-w-0 flex-1 text-[14px] leading-snug text-neutral-700">
                  {leg.minutes} min
                  {leg.to ? (
                    <>
                      {" "}fino a <span className="name text-neutral-900">{leg.to.name}</span>
                    </>
                  ) : leg.from ? (
                    <>
                      {" "}da <span className="name text-neutral-900">{leg.from.name}</span> a destinazione
                    </>
                  ) : (
                    " fino a destinazione"
                  )}
                  {leg.meters != null && <span className="text-neutral-500"> ({leg.meters} m)</span>}
                </span>
              </>
            ) : (
              <>
                <span className="w-[52px] shrink-0">
                  <RouteBadge
                    shortName={leg.shortName}
                    color={leg.color}
                    textColor={leg.textColor}
                    size="sm"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="name block truncate text-[14px] font-medium text-neutral-900">
                    {leg.headsign ?? "Destinazione non indicata"}
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-neutral-600">
                    <Link
                      href={`/stop/${encodeURIComponent(leg.from.stopId)}`}
                      className="underline decoration-neutral-300 underline-offset-2"
                    >
                      {leg.from.name}
                    </Link>{" "}
                    <span className="tabular-nums text-neutral-900">{ora(leg.departAt)}</span>
                    {" → "}
                    <Link
                      href={`/stop/${encodeURIComponent(leg.to.stopId)}`}
                      className="underline decoration-neutral-300 underline-offset-2"
                    >
                      {leg.to.name}
                    </Link>{" "}
                    <span className="tabular-nums text-neutral-900">{ora(leg.arriveAt)}</span>
                  </span>
                </span>
              </>
            )}
          </li>
        ))}
      </ol>

      {walkOption && (
        <p className="border-t border-neutral-200 pt-3 text-[13px] text-neutral-600">
          Oppure <span className="font-semibold text-neutral-900">tutto a piedi</span> in{" "}
          {walkOption.minutes} min ({(walkOption.meters / 1000).toFixed(1)} km)
          {walkOption.minutes < opzione.durationMin && ", che è più rapido"}.
        </p>
      )}

      <p className="mt-3 text-[12px] leading-relaxed text-neutral-500">
        Orari da tabella, senza il tempo reale: un mezzo in ritardo cambia le
        coincidenze. Verifica il passaggio sulla pagina della fermata.
      </p>
    </section>
  );
}
