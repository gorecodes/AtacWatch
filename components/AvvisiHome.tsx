"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { usePolling } from "@/lib/usePolling";

/**
 * L'ingresso agli avvisi dalla home, e solo quando c'è qualcosa da dire.
 *
 * Non è una voce della navigazione in basso: quattro destinazioni fisse ci
 * stanno, cinque no, e uno slot permanente per una pagina spesso vuota è
 * spazio buttato. Qui invece il riquadro compare quando ci sono avvisi di
 * oggi e scompare quando non ce ne sono — che è anche il modo di dire
 * "oggi non c'è niente" senza scriverlo.
 *
 * Conta solo gli urgenti. I cantieri sono sempre attivi: annunciarli in home
 * vorrebbe dire avere un riquadro acceso per sempre, che è esattamente il
 * modo di rendere invisibile un avviso.
 */
export default function AvvisiHome() {
  const [urgenti, setUrgenti] = useState(0);

  const carica = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setUrgenti(json.urgenti ?? 0);
    } catch { /* silenzioso: la home non deve rompersi per un avviso */ }
  }, []);

  usePolling(carica, 5 * 60_000, [carica]);

  if (urgenti === 0) return null;

  return (
    <Link
      href="/avvisi"
      className="flex items-center gap-2.5 rounded border border-amber-300 bg-amber-50 px-3 py-2.5 active:bg-amber-100"
    >
      <span className="text-[15px] font-bold text-amber-900">
        {urgenti === 1 ? "1 avviso oggi" : `${urgenti} avvisi oggi`}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-amber-800">
        deviazioni e percorsi modificati
      </span>
      <span className="shrink-0 text-[13px] font-semibold text-amber-900">›</span>
    </Link>
  );
}
