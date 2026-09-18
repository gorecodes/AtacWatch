/**
 * Glifi dell'interfaccia. Sostituiscono le emoji (🔍 📍 🚌 ★): le emoji
 * cambiano forma su ogni sistema operativo e non si possono colorare, quindi
 * non sono adatte a un'interfaccia che deve leggersi identica su tutti i
 * telefoni.
 */

type GlyphProps = { className?: string };

export function SearchGlyph({ className = "" }: GlyphProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m12.8 12.8 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function PinGlyph({ className = "" }: GlyphProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <path
        d="M10 18s6-5.2 6-9.4A6 6 0 0 0 4 8.6C4 12.8 10 18 10 18Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="8.4" r="2.1" fill="currentColor" />
    </svg>
  );
}

export function StopGlyph({ className = "" }: GlyphProps) {
  // Una palina: palo verticale con la targhetta in cima.
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <rect x="4" y="3" width="12" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 10v7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7 17h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function StarGlyph({ filled, className = "" }: GlyphProps & { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill={filled ? "currentColor" : "none"}
      aria-hidden
      className={className}
    >
      <path
        d="M10 2.8l2.3 4.7 5.2.75-3.75 3.65.88 5.15L10 14.6l-4.63 2.45.88-5.15L2.5 8.25l5.2-.75L10 2.8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronGlyph({ open = false, className = "" }: GlyphProps & { open?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={`transition-transform ${open ? "rotate-180" : ""} ${className}`}
    >
      <path
        d="M5.5 8l4.5 4.5L14.5 8"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BackGlyph({ className = "" }: GlyphProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <path
        d="M12 4.5 6.5 10l5.5 5.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Pallino "dato in tempo reale". Fermo di proposito: su una lista di venti
 * arrivi venti pallini che pulsano sono rumore. Il movimento è concentrato in
 * un punto solo, l'intestazione della fermata, dove significa "questa pagina
 * si sta aggiornando" (vedi LiveBeacon).
 */
export function LiveDot({ className = "" }: GlyphProps) {
  return (
    <span
      title="Dato in tempo reale"
      className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-live-500 ${className}`}
    />
  );
}

export function SunGlyph({ className = "" }: GlyphProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <circle cx="10" cy="10" r="3.6" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M10 1.8v1.8M10 16.4v1.8M1.8 10h1.8M16.4 10h1.8M4.2 4.2l1.3 1.3M14.5 14.5l1.3 1.3M15.8 4.2l-1.3 1.3M5.5 14.5l-1.3 1.3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MoonGlyph({ className = "" }: GlyphProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <path
        d="M16.2 12.6a6.8 6.8 0 0 1-8.8-8.8 7 7 0 1 0 8.8 8.8Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Ritardi: un orologio, con le lancette oltre l'orario. */
export function DelayGlyph({ className = "" }: GlyphProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <circle cx="10" cy="10.6" r="7" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10 6.8v4l2.6 1.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.4 2.6h5.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/** Un percorso: due capi e una linea spezzata che li unisce. */
export function RouteGlyph({ className = "" }: GlyphProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <circle cx="4.5" cy="15.5" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="15.5" cy="4.5" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M4.5 13V9.5A2.5 2.5 0 0 1 7 7h6a2.5 2.5 0 0 0 2.5-2.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Avviso: il triangolo, che è il segno universale e si legge a 14 pixel. */
export function AlertGlyph({ className = "" }: GlyphProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <path
        d="M10 3.2 2.6 16.2h14.8L10 3.2Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M10 8v3.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="10" cy="13.6" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function CloseGlyph({ className = "" }: GlyphProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <path d="m5.5 5.5 9 9m0-9-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function BellGlyph({ filled, className = "" }: GlyphProps & { filled: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill={filled ? "currentColor" : "none"} aria-hidden className={className}>
      <path
        d="M10 2.5a5.5 5.5 0 0 0-5.5 5.5v3l-1.2 2h13.4l-1.2-2V8A5.5 5.5 0 0 0 10 2.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M8.2 15.5a1.8 1.8 0 0 0 3.6 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** L'unico elemento animato dell'app: segnala che i dati si stanno aggiornando. */
export function LiveBeacon({ className = "" }: GlyphProps) {
  return (
    <span className={`relative inline-flex h-2 w-2 shrink-0 ${className}`}>
      <span className="absolute inset-0 animate-ping rounded-full bg-live-500 opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-live-500" />
    </span>
  );
}
