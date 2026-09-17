/**
 * Righe fantasma durante i caricamenti.
 *
 * Al posto di una scritta tipo "Leggo gli arrivi…": una scritta non dice
 * quanto contenuto sta arrivando e fa saltare la pagina quando i dati
 * compaiono, mentre una sagoma della stessa forma tiene lo spazio e
 * l'aggiornamento diventa una sostituzione invece di uno scatto.
 *
 * L'animazione si disattiva da sé con prefers-reduced-motion, gestito in
 * globals.css.
 */
export default function Skeleton({
  righe = 4,
  /** Larghezze decrescenti: un blocco di barre identiche sembra un errore. */
  className = "",
}: {
  righe?: number;
  className?: string;
}) {
  const larghezze = ["w-3/4", "w-2/3", "w-4/5", "w-1/2", "w-3/5", "w-2/5"];
  return (
    <ul aria-hidden className={`animate-pulse divide-y divide-neutral-200 ${className}`}>
      {Array.from({ length: righe }).map((_, i) => (
        <li key={i} className="flex items-center gap-2.5 py-3">
          <span className="h-6 w-9 shrink-0 rounded-[3px] bg-neutral-300" />
          <span className={`h-3.5 rounded bg-neutral-200 ${larghezze[i % larghezze.length]}`} />
          <span className="ml-auto h-4 w-10 shrink-0 rounded bg-neutral-200" />
        </li>
      ))}
    </ul>
  );
}
