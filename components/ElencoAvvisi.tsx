"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { usePolling } from "@/lib/usePolling";
import Skeleton from "./Skeleton";
import type { Avviso } from "@/lib/avvisi";

/**
 * L'elenco completo degli avvisi, per chi vuole guardare tutto.
 *
 * Diviso in due sezioni con due intestazioni esplicite invece di una lista
 * unica ordinata: un cantiere di dieci mesi e una manifestazione di oggi
 * messi nella stessa lista si leggono come la stessa cosa, e non lo sono.
 * Le linee coinvolte sono link: da un avviso si vuole arrivare alla linea.
 */
export default function ElencoAvvisi() {
  const [avvisi, setAvvisi] = useState<Avviso[] | null>(null);
  const [errore, setErrore] = useState(false);

  const carica = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setAvvisi(json.avvisi ?? []);
      setErrore(false);
    } catch {
      setErrore(true);
    }
  }, []);

  usePolling(carica, 5 * 60_000, [carica]);

  if (errore && !avvisi) {
    return (
      <p className="py-6 text-[14px] text-neutral-600">
        Gli avvisi non si fanno trovare.{" "}
        <button onClick={carica} className="font-medium text-brand-600 underline underline-offset-2">
          Riprova
        </button>
      </p>
    );
  }
  if (!avvisi) return <Skeleton righe={5} />;

  const urgenti = avvisi.filter((a) => a.urgente);
  const strutturali = avvisi.filter((a) => !a.urgente);

  if (avvisi.length === 0) {
    return (
      <p className="py-6 text-[14px] text-neutral-600">
        Nessun avviso attivo. Cosa che a Roma succede raramente, quindi
        godiamocela.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {urgenti.length > 0 && (
        <section>
          <h2 className="mb-2 text-[13px] font-semibold text-neutral-500">Oggi</h2>
          <ul className="space-y-2">
            {urgenti.map((a) => (
              <li
                key={a.id}
                className="rounded border border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-900"
              >
                <p className="text-[13px] font-bold leading-snug">
                  {a.effetto}
                  {a.causa && <span className="font-medium"> · {a.causa}</span>}
                  {a.quando && <span className="font-medium"> · {a.quando}</span>}
                </p>
                <p className="mt-0.5 text-[13px] leading-snug">{a.titolo}</p>
                {a.dettaglio && (
                  <p className="mt-1 text-[12px] leading-relaxed text-amber-800">{a.dettaglio}</p>
                )}
                <Linee linee={a.linee} className="mt-1.5" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {strutturali.length > 0 && (
        <section>
          <h2 className="mb-1 text-[13px] font-semibold text-neutral-500">
            Cantieri e modifiche di lungo periodo
          </h2>
          <p className="mb-2 text-[12px] text-neutral-500">
            Vanno avanti da settimane o mesi: utile saperlo una volta, inutile
            essere avvisati ogni giorno.
          </p>
          <ul className="divide-y divide-neutral-200 border-y border-neutral-300">
            {strutturali.map((a) => (
              <li key={a.id} className="py-2.5">
                <p className="text-[13px] leading-snug text-neutral-900">{a.titolo}</p>
                <p className="mt-0.5 text-[12px] text-neutral-500">
                  {a.effetto}
                  {a.causa && ` per ${a.causa}`}
                  {a.quando && ` · ${a.quando}`}
                </p>
                <Linee linee={a.linee} className="mt-1" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Le linee coinvolte, cliccabili. Oltre otto si tronca: la lista è un
 *  dettaglio, non il contenuto. */
function Linee({ linee, className = "" }: { linee: string[]; className?: string }) {
  if (linee.length === 0) return null;
  const mostrate = linee.slice(0, 8);
  const resto = linee.length - mostrate.length;
  return (
    <p className={`flex flex-wrap items-center gap-1 ${className}`}>
      {mostrate.map((l) => (
        <Link
          key={l}
          href={`/line/${encodeURIComponent(l)}`}
          className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-700"
        >
          {l}
        </Link>
      ))}
      {resto > 0 && <span className="text-[11px] text-neutral-500">+{resto}</span>}
    </p>
  );
}
