"use client";

import { useState } from "react";
import { applicaTema, temaAttuale, type Tema } from "@/lib/theme";
import { SunGlyph, MoonGlyph } from "./Glyphs";

/**
 * Tasto chiaro/scuro.
 *
 * Lo stato si legge dalla classe sul documento, che lo script inline ha già
 * messo prima del disegno: non serve un effetto al montaggio, e non c'è il
 * momento in cui l'icona è quella sbagliata.
 *
 * L'icona mostra la modalità in cui si ANDREBBE, non quella attuale: una luna
 * significa "passa a scuro", che è ciò che si vuole sapere premendo.
 */
export default function ThemeToggle() {
  const [tema, setTema] = useState<Tema | null>(null);

  // Al primo disegno lato server il documento non esiste: si risolve alla
  // prima interazione o leggendo pigramente qui, dentro il render del client.
  const corrente = tema ?? (typeof document === "undefined" ? "chiaro" : temaAttuale());
  const prossimo: Tema = corrente === "scuro" ? "chiaro" : "scuro";

  return (
    <button
      onClick={() => {
        applicaTema(prossimo);
        setTema(prossimo);
      }}
      aria-label={prossimo === "scuro" ? "Passa alla modalità scura" : "Passa alla modalità chiara"}
      className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-500 active:bg-neutral-200/60 active:text-neutral-900"
    >
      {prossimo === "scuro" ? <MoonGlyph className="h-5 w-5" /> : <SunGlyph className="h-5 w-5" />}
    </button>
  );
}
