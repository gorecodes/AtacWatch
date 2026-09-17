"use client";

import { useCallback, useState } from "react";
import { usePolling } from "@/lib/usePolling";
import RouteBadge from "./RouteBadge";
import Skeleton from "./Skeleton";

type Linea = {
  short_name: string;
  color: string | null;
  text_color: string | null;
  campioni: number;
  media_s: number;
  perc_ritardo: number;
  peggiore_s: number;
};
type Dati = {
  periodo: { dal: string | null; al: string | null; campioni: number; ore: number };
  minCampioni: number;
  linee: Linea[];
};

/** Un'ora di osservazioni è un aneddoto: sotto questa soglia lo si dice. */
const ORE_PER_FIDARSI = 24;

/** Solo il valore, senza unità: la riga è stretta e va tenuta su una riga. */
function minuti(secondi: number): string {
  const m = Math.round(secondi / 60);
  if (m === 0) return "0";
  return m > 0 ? `+${m}` : `−${Math.abs(m)}`;
}

export default function StatsRitardi() {
  const [dati, setDati] = useState<Dati | null>(null);
  const [errore, setErrore] = useState(false);

  const carica = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/delays", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDati(await res.json());
      setErrore(false);
    } catch {
      setErrore(true);
    }
  }, []);

  // I dati cambiano una volta all'ora: non serve inseguirli.
  usePolling(carica, 10 * 60_000, [carica]);

  if (errore && !dati) {
    return (
      <p className="py-6 text-[14px] text-neutral-600">
        Le statistiche non si fanno trovare.{" "}
        <button onClick={carica} className="font-medium text-brand-600 underline underline-offset-2">
          Riprova
        </button>
      </p>
    );
  }
  if (!dati) return <Skeleton righe={6} />;

  const { periodo, linee, minCampioni } = dati;
  const pochiDati = periodo.ore < ORE_PER_FIDARSI;

  return (
    <div>
      {/* Il campione si dichiara SEMPRE, e prima dei numeri: una percentuale
          senza sapere su quante osservazioni poggia non è un dato. */}
      <p className="mb-4 text-[13px] leading-relaxed text-neutral-600">
        {periodo.campioni.toLocaleString("it-IT")} osservazioni raccolte in{" "}
        {periodo.ore === 1 ? "un'ora" : `${periodo.ore} ore`} di servizio.
        {pochiDati && (
          <>
            {" "}
            <span className="font-semibold text-neutral-900">
              Ancora pochi dati per trarne conclusioni
            </span>
            : con meno di un giorno di raccolta questi numeri raccontano una
            serata, non un&apos;abitudine.
          </>
        )}
      </p>

      {linee.length === 0 ? (
        <p className="py-6 text-[14px] text-neutral-600">
          Nessuna linea ha ancora abbastanza osservazioni. Serve tempo: il
          conteggio va avanti da sé.
        </p>
      ) : (
        <>
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="text-[13px] font-semibold text-neutral-500">Meno puntuali</h2>
            <span className="text-[12px] text-neutral-400">oltre 2 minuti</span>
          </div>
          <ul className="divide-y divide-neutral-200 border-y border-neutral-300">
            {linee.map((l) => (
              <li key={l.short_name} className="flex items-center gap-3 py-2.5">
                <RouteBadge
                  shortName={l.short_name}
                  color={l.color}
                  textColor={l.text_color}
                  size="sm"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] tabular-nums text-neutral-900">
                    <span className="font-semibold">{l.perc_ritardo}%</span>
                    <span className="text-neutral-500"> in ritardo</span>
                  </span>
                  <span className="mt-0.5 block text-[12px] tabular-nums text-neutral-500">
                    {/* L'unità la porta il primo valore: ripeterla su tutti e
                        due manda la riga a capo su uno schermo stretto. */}
                    {Math.round(l.media_s / 60) === 0
                      ? "in media in orario"
                      : `in media ${minuti(l.media_s)} min`}{" "}
                    · punta {minuti(l.peggiore_s)} · {l.campioni.toLocaleString("it-IT")} oss.
                  </span>
                </span>
                {/* Barra proporzionale: a colpo d'occhio dice più di una cifra. */}
                <span className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-neutral-200">
                  <span
                    className="block h-full rounded-full bg-brand-500"
                    style={{ width: `${Math.min(100, l.perc_ritardo)}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-4 space-y-2 text-[12px] leading-relaxed text-neutral-500">
        <p>
          Come si misura: a ogni aggiornamento si guarda lo scostamento dichiarato da ATAC
          per la prossima fermata di ogni corsa in servizio. Compaiono solo le linee con
          almeno {minCampioni} osservazioni, perché sotto quella soglia una percentuale è
          rumore travestito da dato.
        </p>
        <p>
          Gli scostamenti oltre i 45 minuti e gli anticipi oltre i 10 sono scartati: nel
          feed ATAC si trovano valori fino a tre ore e mezza, che non sono ritardi ma
          errori di trasmissione.
        </p>
      </div>
    </div>
  );
}
