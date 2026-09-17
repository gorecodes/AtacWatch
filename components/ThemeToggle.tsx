"use client";

import { SunGlyph, MoonGlyph } from "./Glyphs";
import { applicaTema, temaAttuale } from "@/lib/theme";

/**
 * Tasto chiaro/scuro.
 *
 * Nessuno stato React, ed è deliberato. La versione precedente leggeva il tema
 * dal documento DURANTE il render: sul server il documento non esiste, quindi
 * il primo disegno diceva "chiaro" e l'idratazione diceva "scuro". Il
 * disallineamento faceva restare l'icona sbagliata dopo un ricaricamento, e il
 * primo tocco sembrava non fare niente.
 *
 * Ora entrambe le icone sono nel documento e il CSS ne mostra una sola, in
 * base alla classe che lo script inline ha già messo prima del disegno: il
 * server e il client producono lo stesso HTML, e non c'è niente da idratare.
 * Il tema si legge solo al tocco, dentro un gestore di evento.
 */
export default function ThemeToggle() {
  return (
    <button
      onClick={() => applicaTema(temaAttuale() === "scuro" ? "chiaro" : "scuro")}
      aria-label="Cambia tra modalità chiara e scura"
      className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-500 active:bg-neutral-200/60 active:text-neutral-900"
    >
      {/* L'icona mostra la modalità in cui si ANDREBBE: in chiaro una luna,
          perché premendo si passa a scuro. */}
      <MoonGlyph className="h-5 w-5 dark:hidden" />
      <SunGlyph className="hidden h-5 w-5 dark:block" />
    </button>
  );
}
