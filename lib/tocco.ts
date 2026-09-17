"use client";

/**
 * Riscontro fisico sui gesti che confermano qualcosa.
 *
 * Solo dove si CAMBIA uno stato — attivo una notifica, salvo un preferito,
 * riordino — e mai sulla semplice navigazione: una vibrazione a ogni tocco
 * diventa rumore e la gente disattiva tutto.
 *
 * L'API non esiste su iOS, e su Android può essere disattivata dalle
 * impostazioni di sistema: è un rinforzo, non un canale di informazione, e
 * l'app funziona identica senza.
 */
export function tocco(intensita: "leggero" | "doppio" = "leggero"): void {
  try {
    if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
    // 12ms è appena percepibile: abbastanza da sentirsi, poco da infastidire.
    navigator.vibrate(intensita === "doppio" ? [12, 40, 12] : 12);
  } catch {
    // niente: il riscontro fisico non è mai indispensabile
  }
}
