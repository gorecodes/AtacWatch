import SearchBar from "@/components/SearchBar";
import NearbyArrivals from "@/components/NearbyArrivals";
import FavoriteStops from "@/components/FavoriteStops";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-lg px-4 pt-5">
      {/* Intestazione su una riga sola: prima i crediti e il sottotitolo si
          mangiavano 130px dei 900 di viewport, sopra la piega. */}
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h1 className="name text-[26px] font-bold leading-none tracking-tight text-neutral-900">
          AtacWatch
        </h1>
        <p className="shrink-0 text-[13px] text-neutral-500">Roma in tempo reale</p>
      </header>

      <SearchBar />

      {/* I preferiti prima: non richiedono il permesso di posizione, quindi
          sono l'unica cosa che può essere utile al primo colpo. */}
      <div className="mt-6 space-y-7">
        <FavoriteStops />
        <NearbyArrivals />
      </div>
    </div>
  );
}
