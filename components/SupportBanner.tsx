"use client";

import { useEffect, useState } from "react";
import { CloseGlyph } from "./Glyphs";

/** Visibile sempre, finché non viene chiuso: allora non torna più. */
const DISMISSED_KEY = "busroma_support_dismissed";

export default function SupportBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(DISMISSED_KEY)) setShow(true);
    } catch {
      setShow(true); // navigazione privata: mostralo comunque
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
        se ti è utile.
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
