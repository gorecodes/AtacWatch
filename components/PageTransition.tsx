"use client";

import { usePathname } from "next/navigation";

/**
 * Comparsa breve a ogni cambio di pagina.
 *
 * La chiave è il percorso, quindi il contenuto viene rimontato e l'animazione
 * riparte. Volutamente NON include la query: passando da ?dir=0 a ?dir=1 sulla
 * pagina di una linea si cambia solo il verso, e far lampeggiare la pagina per
 * quello sarebbe fastidioso.
 *
 * Non si usa l'API View Transitions perché in Next.js le navigazioni sono
 * lato client e servirebbe il supporto sperimentale del framework: questa
 * soluzione è di tre righe, non aggiunge dipendenze e funziona su tutti i
 * browser.
 */
export default function PageTransition({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div key={path} className="entrata-pagina">
      {children}
    </div>
  );
}
