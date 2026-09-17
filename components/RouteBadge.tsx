import { routeBadgeStyle, routeTypeInfo } from "@/lib/gtfs";

/**
 * La targhetta della linea, come sul palo di una fermata: numero in un
 * riquadro, cifre tabulari, angoli appena smussati. È l'ancora visiva di ogni
 * riga dell'app, quindi resta l'unico elemento sempre pieno di colore.
 */
export default function RouteBadge({
  shortName,
  type,
  color,
  textColor,
  size = "md",
}: {
  shortName: string;
  type?: number;
  color?: string | null;
  textColor?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const cls =
    size === "lg"
      ? "min-w-14 px-2 py-1 text-[22px] leading-tight"
      : size === "sm"
        ? "min-w-8 px-1.5 py-0.5 text-[13px] leading-snug"
        : "min-w-10 px-1.5 py-0.5 text-[15px] leading-snug";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-[3px] font-bold tracking-tight tabular-nums ${cls}`}
      style={routeBadgeStyle(color ?? null, textColor ?? null)}
      title={type != null ? routeTypeInfo(type).label : undefined}
    >
      {shortName}
    </span>
  );
}
