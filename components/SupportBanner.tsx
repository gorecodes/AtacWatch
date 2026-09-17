"use client";

import { useEffect, useState } from "react";
import { CloseGlyph } from "./Glyphs";

/**
 * Chiede un contributo solo a chi usa l'app da un po': il footer globale non lo
 * legge nessuno, ma un banner al primo avvio sarebbe mendicare prima di aver
 * dato qualcosa. Compare dalla decima apertura (una o due settimane di uso
 * quotidiano) e una volta chiuso non torna più.
 */
const OPENS_KEY = "busroma_opens";
const DISMISSED_KEY = "busroma_support_dismissed";
const SESSION_KEY = "busroma_counted";
const MIN_OPENS = 10;

export default function SupportBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISSED_KEY)) return;

      // Una apertura = una sessione, non una navigazione fra pagine.
      let opens = Number(localStorage.getItem(OPENS_KEY) ?? "0");
      if (!sessionStorage.getItem(SESSION_KEY)) {
        opens += 1;
        localStorage.setItem(OPENS_KEY, String(opens));
        sessionStorage.setItem(SESSION_KEY, "1");
      }
      if (opens >= MIN_OPENS) setShow(true);
    } catch {
      // localStorage non disponibile (navigazione privata): nessun banner
    }
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {}
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="flex items-start gap-3 border-y border-neutral-300 py-3">
      <p className="flex-1 text-[13px] leading-snug text-neutral-600">
        Bus Roma è gratis e senza pubblicità.{" "}
        <a
          href="https://ko-fi.com/codingpao"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-neutral-900 underline underline-offset-2"
        >
          Offrimi un caffè
        </a>{" "}
        se ti sta risparmiando qualche attesa.
      </p>
      <button
        onClick={dismiss}
        aria-label="Chiudi"
        className="-mr-1 shrink-0 rounded p-1 text-neutral-400 active:text-neutral-700"
      >
        <CloseGlyph className="h-4 w-4" />
      </button>
    </div>
  );
}
