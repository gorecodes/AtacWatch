/**
 * Il marchio per l'interfaccia: la palina, senza il riquadro di fondo.
 *
 * L'icona della schermata home (public/icon.svg) ha il fondo basalto e gli
 * angoli smussati, perché lì deve reggere contro lo sfondo di sistema. A 28
 * pixel dentro un'intestazione quel riquadro scuro peserebbe più del titolo,
 * quindi qui resta solo la sagoma: targhetta rossa, palo, e il pallino verde
 * del dato vivo.
 *
 * Il palo usa currentColor, così segue il tema chiaro/scuro come il testo
 * accanto; la targhetta e il pallino restano i colori dell'app, perché sono
 * identità e non decorazione.
 */
export default function Marchio({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={className}>
      {/* Palo e base. */}
      <path
        d="M16 13.5v14M11.5 27.5h9"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.55"
      />
      {/* La targhetta. */}
      <rect x="2" y="3" width="28" height="11.5" rx="2.2" fill="#C4161C" />
      {/* Una sola barra: a questa dimensione due diventano una macchia. */}
      <rect x="5.5" y="7.4" width="15" height="2.6" rx="1.3" fill="#FFFFFF" />
      {/* Il pallino del dato vivo. */}
      <circle cx="25.4" cy="8.7" r="2.5" fill="#00875A" />
    </svg>
  );
}
