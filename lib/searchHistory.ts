"use client";

/**
 * Ultime ricerche, sul telefono di chi cerca.
 *
 * Si memorizza ciò che viene SCELTO, non ciò che viene digitato: "term" è un
 * testo da ridigitare, una fermata scelta è un posto dove tornare con un tocco.
 * Per questo ogni voce porta con sé quanto basta a ridisegnarsi senza
 * interrogare il server.
 */
export type VoceStorico =
  | {
      kind: "line";
      id: string;
      label: string;
      shortName: string;
      type: number;
      color: string | null;
      textColor: string | null;
    }
  | { kind: "stop"; id: string; label: string; code: string | null };

const KEY = "busroma_ricerche";
const MAX = 5;

export function leggiStorico(): VoceStorico[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** Aggiunge in testa, senza duplicati, tenendo le ultime MAX. */
export function aggiungiStorico(voce: VoceStorico): VoceStorico[] {
  try {
    const attuale = leggiStorico().filter((v) => !(v.kind === voce.kind && v.id === voce.id));
    const nuovo = [voce, ...attuale].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(nuovo));
    return nuovo;
  } catch {
    return [];
  }
}

export function svuotaStorico(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
