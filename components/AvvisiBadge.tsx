"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { usePolling } from "@/lib/usePolling";
import { AlertGlyph } from "./Glyphs";

/**
 * Conteggio degli avvisi di oggi nell'header, a sinistra dello stato del feed.
 *
 * FORMA MINIMA, per una ragione misurata e non estetica: su 360px l'header
 * della pagina linea ha già indietro (82px), "3 mezzi in linea" (110px),
 * stato del feed (48px) e tasto tema (44px), cioè 284 dei 328 disponibili.
 * Scrivere "3 avvisi" avrebbe sfondato la riga. Il triangolo più il numero
 * stanno in trenta pixel, e il numero da solo basta: chi vuole sapere cosa,
 * tocca.
 *
 * Conta solo gli urgenti. I cantieri sono attivi sempre: metterli qui
 * significherebbe avere il badge acceso per sempre, che è il modo più
 * efficace di rendere invisibile un avviso.
 */
export default function AvvisiBadge() {
  const [urgenti, setUrgenti] = useState(0);

  const carica = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setUrgenti(json.urgenti ?? 0);
    } catch { /* silenzioso: l'header non deve rompersi per un avviso */ }
  }, []);

  usePolling(carica, 5 * 60_000, [carica]);

  if (urgenti === 0) return null;

  return (
    <Link
      href="/avvisi"
      aria-label={`${urgenti} avvisi di servizio oggi`}
      className="flex shrink-0 items-center gap-0.5 text-warn-600 active:text-warn-700"
    >
      <AlertGlyph className="h-[13px] w-[13px]" />
      <span className="text-[12px] font-semibold tabular-nums">{urgenti}</span>
    </Link>
  );
}
