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
