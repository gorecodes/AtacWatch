"use client";

import { CloseGlyph } from "./Glyphs";

/**
 * Tre righe al primo avvio: cos'è l'app e cosa NON è.
 *
 * La terza riga è la più importante e non è ironica: gli orari vengono da
 * ATAC, e prometterne l'esattezza sarebbe una bugia che si paga alla fermata.
 * Dirlo subito è più onesto che farlo scoprire aspettando un autobus che non
 * arriva.
 *
 * Nessuno stato React, come per il tasto del tema: lo script inline nel
 * documento marca `visto` sull'elemento radice prima del disegno, e il CSS
 * nasconde il riquadro. Leggendo localStorage dopo l'idratazione si vedrebbe
 * il benvenuto comparire e sparire a ogni apertura.
 */
export const CHIAVE_BENVENUTO = "busroma_benvenuto";

export default function Benvenuto() {
  return (
    <div className="benvenuto mb-5 rounded border border-neutral-300 bg-neutral-50 p-3.5">
      <div className="mb-1.5 flex items-start justify-between gap-2">
        {/* Qui il nome ci sta: è l'unico momento in cui chi legge non sa ancora
            cosa ha aperto. Dalla seconda apertura questo riquadro non c'è più,
            e nemmeno il nome serve più. */}
        <h2 className="text-[15px] font-bold text-neutral-900">
          Benvenuto a bordo di <span className="name">Bus Roma</span>
        </h2>
        <button
          onClick={() => {
            try {
              localStorage.setItem(CHIAVE_BENVENUTO, "1");
            } catch {
              // navigazione privata: ricomparirà, che è meglio del contrario
            }
            document.documentElement.classList.add("visto");
          }}
          aria-label="Chiudi"
          className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-400 active:text-neutral-700"
        >
          <CloseGlyph className="h-4 w-4" />
        </button>
      </div>
      <ul className="space-y-1.5 text-[13px] leading-snug text-neutral-600">
        <li>
          <span className="font-semibold text-neutral-900">Cerca una fermata</span> per numero di
          palina, o guarda cosa passa qui intorno.
        </li>
        <li>
          <span className="font-semibold text-neutral-900">Tocca la campanella</span> e ti avviso
          quando quel mezzo sta arrivando, anche a schermo spento.
        </li>
        <li>
          Gli orari sono quelli di ATAC: in verde quando un mezzo è tracciato davvero, in grigio
          quando è solo previsto. Del resto non rispondiamo noi.
        </li>
      </ul>
    </div>
  );
}
