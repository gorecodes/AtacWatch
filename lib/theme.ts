"use client";

/**
 * Tema chiaro/scuro.
 *
 * Senza scelta salvata si segue il sistema: chi ha il telefono in scuro trova
 * l'app in scuro senza dover fare niente. Il tasto salva una scelta esplicita,
 * che da quel momento vince sul sistema.
 *
 * L'applicazione vera avviene in uno script inline nel documento (vedi
 * app/layout.tsx): se il tema si applicasse dopo l'idratazione, si vedrebbe un
 * lampo di bianco a ogni apertura.
 */
export type Tema = "chiaro" | "scuro";

export const CHIAVE_TEMA = "busroma_tema";

export function temaAttuale(): Tema {
  return document.documentElement.classList.contains("dark") ? "scuro" : "chiaro";
}

export function applicaTema(t: Tema): void {
  document.documentElement.classList.toggle("dark", t === "scuro");
  try {
    localStorage.setItem(CHIAVE_TEMA, t);
  } catch {
    // navigazione privata: il tema resta per questa sessione
  }
}
