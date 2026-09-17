import Link from "next/link";
import SearchBar from "@/components/SearchBar";
import { RouteGlyph } from "@/components/Glyphs";
import NearbyArrivals from "@/components/NearbyArrivals";
import FavoriteStops from "@/components/FavoriteStops";
import SupportBanner from "@/components/SupportBanner";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-lg px-4 pt-5">
      {/* Intestazione su una riga sola: prima i crediti e il sottotitolo si
          mangiavano 130px dei 900 di viewport, sopra la piega. */}
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h1 className="name text-[26px] font-bold leading-none tracking-tight text-neutral-900">
          Bus Roma
        </h1>
        <p className="shrink-0 text-[13px] text-neutral-500">Roma in tempo reale</p>
      </header>

      <SearchBar />

      <Link
        href="/plan"
        className="mt-3 flex items-center gap-2 border-y border-neutral-300 py-2.5 active:bg-neutral-200/40"
      >
        <RouteGlyph className="h-5 w-5 shrink-0 text-brand-500" />
        <span className="flex-1 text-[15px] font-medium text-neutral-900">Calcola un percorso</span>
        <span className="text-neutral-400">›</span>
      </Link>

      {/* I preferiti prima: non richiedono il permesso di posizione, quindi
          sono l'unica cosa che può essere utile al primo colpo. */}
      <div className="mt-6 space-y-7">
        <FavoriteStops />
        <SupportBanner />
        <NearbyArrivals />
      </div>
    </div>
  );
}
