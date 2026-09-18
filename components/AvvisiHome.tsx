"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { usePolling } from "@/lib/usePolling";

/**
 * L'ingresso agli avvisi dalla home, e solo quando c'è qualcosa da dire.
 *
 * Non è una voce della navigazione in basso: quattro destinazioni fisse ci
 * stanno, cinque no, e uno slot permanente per una pagina spesso vuota è
 * spazio buttato. Qui invece la riga compare quando ci sono avvisi di oggi e
 * scompare quando non ce ne sono — che è anche il modo di dire "oggi non c'è
 * niente" senza scriverlo.
 *
 * Una riga, non un riquadro: la prima versione era un blocco ambrato con il
 * testo in grassetto, e sopra la ricerca pesava più del contenuto della
 * pagina. Il numero basta, chi è interessato tocca.
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
    <Link href="/avvisi" className="flex items-center gap-1.5 py-0.5">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
      <span className="text-[12px] text-amber-700">
        {urgenti === 1 ? "1 avviso oggi" : `${urgenti} avvisi oggi`}
      </span>
      <span className="text-[12px] text-neutral-400 underline underline-offset-2">vedi</span>
    </Link>
  );
}
