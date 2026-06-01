import { routeBadgeStyle, routeTypeInfo } from "@/lib/gtfs";

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
      ? "min-w-12 px-2.5 py-1.5 text-lg"
      : size === "sm"
        ? "min-w-7 px-1.5 py-0.5 text-xs"
        : "min-w-9 px-2 py-1 text-sm";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-bold tabular-nums ${cls}`}
      style={routeBadgeStyle(color ?? null, textColor ?? null)}
      title={type != null ? routeTypeInfo(type).label : undefined}
    >
      {shortName}
    </span>
  );
}
