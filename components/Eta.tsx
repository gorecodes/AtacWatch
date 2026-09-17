import { minutesUntil } from "@/lib/gtfs";
import { LiveDot } from "./Glyphs";

/**
 * L'attesa: il dato per cui si apre l'app, quindi il numero è l'elemento più
 * grande della riga, con l'unità rimpicciolita accanto.
 *
 * La colonna ha larghezza fissa e allineamento a destra: così le cifre di
 * tutte le righe si incolonnano e la lista si scorre con l'occhio. Senza
 * larghezza fissa "in arrivo" (lunga) e "2 min" (corta) sfrangiavano il bordo.
 */
export default function Eta({
  etaTs,
  isRealtime,
  now,
  size = "md",
}: {
  etaTs: string;
  isRealtime: boolean;
  now: number;
  size?: "sm" | "md";
}) {
  const min = minutesUntil(etaTs, now);
  const color = isRealtime ? "text-live-600" : "text-neutral-700";
  const num = size === "md" ? "text-[21px]" : "text-[16px]";
  const unit = size === "md" ? "text-[13px]" : "text-[11px]";
  const box = size === "md" ? "w-[76px]" : "w-[62px]";

  return (
    <span className={`flex shrink-0 items-center justify-end gap-1.5 ${box}`}>
      {isRealtime && <LiveDot />}
      <span className={`font-semibold tabular-nums leading-none ${color}`}>
        {min <= 0 ? (
          <span className={size === "md" ? "text-[15px]" : "text-[13px]"}>in arrivo</span>
        ) : (
          <>
            <span className={num}>{min}</span>
            <span className={`ml-0.5 font-medium ${unit}`}>min</span>
          </>
        )}
      </span>
    </span>
  );
}
