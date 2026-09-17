/**
 * Il marchio per l'interfaccia: la palina, senza il riquadro di fondo.
 *
 * Gialla, stretta e alta su un palo visibile, come quelle di Roma. Due cose
 * imparate disegnando l'icona grande: il rosso ATAC è il colore dei MEZZI e
 * non dell'insegna di fermata, e se la targhetta è larga col palo nascosto
 * dietro, la forma legge come una scheda gialla invece che come una palina.
 *
 * A 28 pixel resta una sola barra: due si impastano.
 *
 * Il palo usa currentColor e segue il tema come il testo accanto; il giallo
 * della targhetta resta fisso, perché è identità e non decorazione.
 */
export default function Marchio({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={className}>
      {/* Palo e base, corti: accanto a un titolo in grassetto il disegno deve
          pesare, e un palo lungo lascia solo spazio vuoto. */}
      <path
        d="M23 5v22M19 27h8"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        opacity="0.5"
      />
      {/* La targhetta riempie il riquadro: a 12 unità su 32 era una macchiolina. */}
      <rect x="4" y="3" width="19" height="21" rx="3" fill="#F5B916" />
      {/* Due numeri di linea: a questa dimensione ci stanno, se sono grossi. */}
      <rect x="7.5" y="7.5" width="12" height="3.6" rx="1.8" fill="#1B2027" />
      <rect x="7.5" y="14" width="8.5" height="3.6" rx="1.8" fill="#1B2027" opacity="0.75" />
    </svg>
  );
}
