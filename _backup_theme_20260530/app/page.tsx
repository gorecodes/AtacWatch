import SearchBar from "@/components/SearchBar";
import NearbyArrivals from "@/components/NearbyArrivals";
import FavoriteStops from "@/components/FavoriteStops";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-lg px-4 pt-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Attàccate</h1>
        <p className="text-sm text-neutral-500">Mezzi di Roma in tempo reale</p>
      </header>

      <SearchBar />

      <div className="mt-6">
        <FavoriteStops />
        <NearbyArrivals />
      </div>

      <footer className="mt-10 text-center text-[11px] leading-relaxed text-neutral-600">
        Dati: Roma Servizi per la Mobilità (ATAC, Roma TPL) — licenza CC-BY-SA.
      </footer>
    </div>
  );
}
